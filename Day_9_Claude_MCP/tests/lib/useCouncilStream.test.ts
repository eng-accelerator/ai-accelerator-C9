import { describe, it, expect, afterEach } from 'vitest'
import { reduceEvent, INITIAL_STATE, startCouncilStream } from '@/lib/useCouncilStream'
import type { StreamState } from '@/lib/useCouncilStream'
import type { CouncilEvent } from '@/council/events'
import { DEFAULT_CONFIG } from '@/council/config'
import { encodeEvent } from '@/lib/sse'

function apply(events: CouncilEvent[]) {
  return events.reduce(reduceEvent, INITIAL_STATE)
}

const usage = { promptTokens: 10, completionTokens: 5, costUsd: 0.001 }

describe('reduceEvent', () => {
  it('marks the run running and records the id', () => {
    const s = apply([{ type: 'run_started', runId: 'r1', config: DEFAULT_CONFIG }])
    expect(s.status).toBe('running')
    expect(s.runId).toBe('r1')
  })

  it('accumulates streamed tokens per seat', () => {
    const s = apply([
      { type: 'run_started', runId: 'r1', config: DEFAULT_CONFIG },
      { type: 'seat_started', seat: 1, model: 'm1' },
      { type: 'token', seat: 1, text: 'hel' },
      { type: 'token', seat: 1, text: 'lo' },
    ])
    expect(s.drafts[1].text).toBe('hello')
    expect(s.drafts[1].status).toBe('streaming')
  })

  it('keeps seats independent', () => {
    const s = apply([
      { type: 'token', seat: 1, text: 'a' },
      { type: 'token', seat: 2, text: 'b' },
    ])
    expect(s.drafts[1].text).toBe('a')
    expect(s.drafts[2].text).toBe('b')
  })

  it('marks a seat ok on seat_done', () => {
    const s = apply([
      { type: 'token', seat: 1, text: 'a' },
      { type: 'seat_done', seat: 1, usage },
    ])
    expect(s.drafts[1].status).toBe('ok')
  })

  it('marks a seat failed and keeps the reason', () => {
    const s = apply([{ type: 'seat_failed', seat: 2, reason: 'timed out' }])
    expect(s.drafts[2].status).toBe('failed')
    expect(s.drafts[2].error).toBe('timed out')
  })

  it('tracks the current stage', () => {
    const s = apply([
      { type: 'stage_started', stage: 'draft' },
      { type: 'stage_done', stage: 'draft' },
      { type: 'stage_started', stage: 'critique' },
    ])
    expect(s.stage).toBe('critique')
  })

  it('stores the verdict', () => {
    const verdict = {
      answer_markdown: '# A',
      provenance: [],
      contested: [],
      confidence: 'high' as const,
    }
    const s = apply([{ type: 'verdict', payload: verdict, confidenceAdjusted: false }])
    expect(s.verdict!.answer_markdown).toBe('# A')
  })

  it('records runId and usage on run_done without marking done yet', () => {
    const s = apply([
      { type: 'run_started', runId: 'r1', config: DEFAULT_CONFIG },
      { type: 'run_done', runId: 'r1', usage: { promptTokens: 700, completionTokens: 350, costUsd: 0.08 } },
    ])
    expect(s.status).toBe('running')
    expect(s.runId).toBe('r1')
    expect(s.usage.costUsd).toBe(0.08)
  })

  it('marks the run failed with a reason', () => {
    const s = apply([{ type: 'run_failed', runId: 'r1', reason: 'quorum not met' }])
    expect(s.status).toBe('failed')
    expect(s.error).toBe('quorum not met')
  })

  it('does not mutate the previous state', () => {
    const before = apply([{ type: 'token', seat: 1, text: 'a' }])
    const after = reduceEvent(before, { type: 'token', seat: 1, text: 'b' })
    expect(before.drafts[1].text).toBe('a')
    expect(after.drafts[1].text).toBe('ab')
  })
})

describe('startCouncilStream', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('marks the run failed when fetch throws', async () => {
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch')
    }

    let state: StreamState = INITIAL_STATE
    const setState = (update: StreamState | ((prev: StreamState) => StreamState)) => {
      state = typeof update === 'function' ? update(state) : update
    }

    await startCouncilStream('what is quorum?', DEFAULT_CONFIG, setState)

    expect(state.status).toBe('failed')
    expect(state.error).toBe('Failed to fetch')
  })

  it('marks done only after the SSE reader finishes, keeping runId from run_done', async () => {
    const frames = [
      encodeEvent({ type: 'run_started', runId: 'r1', config: DEFAULT_CONFIG }),
      encodeEvent({
        type: 'run_done',
        runId: 'r1',
        usage: { promptTokens: 1, completionTokens: 1, costUsd: 0.01 },
      }),
    ].join('')

    globalThis.fetch = async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frames))
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    }

    let state: StreamState = INITIAL_STATE
    const setState = (update: StreamState | ((prev: StreamState) => StreamState)) => {
      state = typeof update === 'function' ? update(state) : update
    }

    await startCouncilStream('q', DEFAULT_CONFIG, setState)

    expect(state.status).toBe('done')
    expect(state.runId).toBe('r1')
    expect(state.usage.costUsd).toBe(0.01)
  })

  it('aborts the reader when the signal aborts and does not mark failed', async () => {
    const ac = new AbortController()
    globalThis.fetch = async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              encodeEvent({ type: 'run_started', runId: 'r1', config: DEFAULT_CONFIG }),
            ),
          )
          init?.signal?.addEventListener('abort', () => {
            try {
              controller.close()
            } catch {
              // already closed by reader.cancel
            }
          })
        },
      })
      return new Response(stream, { status: 200 })
    }

    let state: StreamState = INITIAL_STATE
    const setState = (update: StreamState | ((prev: StreamState) => StreamState)) => {
      state = typeof update === 'function' ? update(state) : update
    }

    const done = startCouncilStream('q', DEFAULT_CONFIG, setState, ac.signal)
    await new Promise((r) => setTimeout(r, 10))
    ac.abort()
    await done

    expect(state.status).not.toBe('failed')
  })
})
