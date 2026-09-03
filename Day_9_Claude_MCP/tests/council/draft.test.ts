import { describe, it, expect } from 'vitest'
import { runDraftStage, DRAFT_SYSTEM } from '@/council/stages/draft'
import { makeFakeProvider } from '@/council/providers/fake'
import type { CouncilEvent } from '@/council/events'
import type { CouncilConfig } from '@/council/config'
import type { Provider, StreamHandle } from '@/council/providers/types'

const ZU = { promptTokens: 1, completionTokens: 1, costUsd: 0 }

const config: CouncilConfig = {
  drafters: [
    { id: 1, model: 'm1', label: 'Seat 1', lab: 'L1' },
    { id: 2, model: 'm2', label: 'Seat 2', lab: 'L2' },
    { id: 3, model: 'm3', label: 'Seat 3', lab: 'L3' },
  ],
  judge: { id: 0, model: 'mj', label: 'Judge', lab: 'L4' },
  timeoutMs: 1000,
}

function collect() {
  const events: CouncilEvent[] = []
  return { events, emit: (e: CouncilEvent) => events.push(e) }
}

describe('runDraftStage', () => {
  it('returns one result per drafter, in seat order', async () => {
    const p = makeFakeProvider({ m1: { text: 'a' }, m2: { text: 'b' }, m3: { text: 'c' } })
    const { emit } = collect()
    const out = await runDraftStage('Q', config, p, emit)
    expect(out.map((d) => d.seatId)).toEqual([1, 2, 3])
    expect(out.map((d) => d.text)).toEqual(['a', 'b', 'c'])
  })

  it('emits token events for every seat', async () => {
    const p = makeFakeProvider({
      m1: { text: 'abcd', chunkSize: 2 },
      m2: { text: 'ef', chunkSize: 2 },
      m3: { text: 'gh', chunkSize: 2 },
    })
    const { events, emit } = collect()
    await runDraftStage('Q', config, p, emit)
    const tokens = events.filter((e) => e.type === 'token')
    expect(tokens.filter((t) => t.seat === 1).map((t) => t.text)).toEqual(['ab', 'cd'])
    expect(tokens.some((t) => t.seat === 2)).toBe(true)
  })

  it('emits stage_started before any seat_started, and stage_done last', async () => {
    const p = makeFakeProvider({ m1: { text: 'a' }, m2: { text: 'b' }, m3: { text: 'c' } })
    const { events, emit } = collect()
    await runDraftStage('Q', config, p, emit)
    expect(events[0]).toMatchObject({ type: 'stage_started', stage: 'draft' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_done', stage: 'draft' })
  })

  it('marks a failing seat as failed and keeps the survivors', async () => {
    const p = makeFakeProvider({ m1: { text: 'a' }, m2: { error: 'boom' }, m3: { text: 'c' } })
    const { events, emit } = collect()
    const out = await runDraftStage('Q', config, p, emit)
    expect(out.find((d) => d.seatId === 2)!.status).toBe('failed')
    expect(out.filter((d) => d.status === 'ok')).toHaveLength(2)
    expect(events.some((e) => e.type === 'seat_failed' && e.seat === 2)).toBe(true)
  })

  it('runs seats in parallel rather than in sequence', async () => {
    const p = makeFakeProvider({
      m1: { text: 'a', delayMs: 60 },
      m2: { text: 'b', delayMs: 60 },
      m3: { text: 'c', delayMs: 60 },
    })
    const started = Date.now()
    await runDraftStage('Q', config, p, () => {})
    expect(Date.now() - started).toBeLessThan(150)
  })

  it('never tells a drafter that other models exist', async () => {
    const p = makeFakeProvider({ m1: { text: 'a' }, m2: { text: 'b' }, m3: { text: 'c' } })
    await runDraftStage('Q', config, p, () => {})
    for (const req of p.requests) {
      const whole = `${req.system}\n${req.user}`
      expect(whole).not.toMatch(/other model|council|peer|seat \d|draft [ab]\b/i)
    }
  })

  it('instructs the drafter not to identify itself', () => {
    expect(DRAFT_SYSTEM).toMatch(/do not (?:name|identify|mention)/i)
  })

  it('retries a stream once after failure then succeeds', async () => {
    let calls = 0
    const p: Provider = {
      complete() {
        throw new Error('not used')
      },
      stream(req) {
        calls++
        let settle: (c: { text: string; usage: typeof ZU; model: string }) => void = () => {}
        let fail: (e: unknown) => void = () => {}
        const done = new Promise<{ text: string; usage: typeof ZU; model: string }>((res, rej) => {
          settle = res
          fail = rej
        })
        async function* gen() {
          if (calls === 1) {
            const err = new Error('stream boom')
            fail(err)
            throw err
          }
          yield { text: 'recovered' }
          settle({ text: 'recovered', usage: ZU, model: req.model })
        }
        const handle = gen() as unknown as StreamHandle
        Object.defineProperty(handle, 'done', { value: done })
        void done.catch(() => {})
        return handle
      },
    }

    const solo = {
      ...config,
      drafters: [config.drafters[0]],
    }
    const out = await runDraftStage('Q', solo, p, () => {})
    expect(calls).toBe(2)
    expect(out[0].status).toBe('ok')
    expect(out[0].text).toBe('recovered')
  })
})
