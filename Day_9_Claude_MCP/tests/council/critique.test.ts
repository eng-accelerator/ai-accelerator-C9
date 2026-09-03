import { describe, it, expect } from 'vitest'
import { runCritiqueStage, CRITIQUE_SYSTEM } from '@/council/stages/critique'
import { makeFakeProvider } from '@/council/providers/fake'
import type { DraftResult } from '@/council/stages/draft'
import type { CouncilConfig } from '@/council/config'
import type { CouncilEvent } from '@/council/events'

const config: CouncilConfig = {
  drafters: [
    { id: 1, model: 'm1', label: 'Seat 1', lab: 'L1' },
    { id: 2, model: 'm2', label: 'Seat 2', lab: 'L2' },
    { id: 3, model: 'm3', label: 'Seat 3', lab: 'L3' },
  ],
  judge: { id: 0, model: 'mj', label: 'Judge', lab: 'L4' },
  timeoutMs: 1000,
}

const drafts: DraftResult[] = [
  { seatId: 1, model: 'm1', label: 'Seat 1', text: 'alpha draft', usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 }, status: 'ok' },
  { seatId: 2, model: 'm2', label: 'Seat 2', text: 'beta draft', usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 }, status: 'ok' },
  { seatId: 3, model: 'm3', label: 'Seat 3', text: 'gamma draft', usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 }, status: 'ok' },
]

const goodCritique = JSON.stringify({
  critiques: [
    { target: 'A', strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
    { target: 'B', strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
  ],
  revised_answer: 'revised',
})

const allGood = { m1: { text: goodCritique }, m2: { text: goodCritique }, m3: { text: goodCritique } }

describe('runCritiqueStage', () => {
  it('produces one critique per drafter', async () => {
    const p = makeFakeProvider(allGood)
    const out = await runCritiqueStage('Q', drafts, config, p, () => {}, 42)
    expect(out).toHaveLength(3)
    expect(out.every((c) => c.status === 'ok')).toBe(true)
  })

  it('never places a seat id, model name, or lab name in a critic prompt', async () => {
    const p = makeFakeProvider(allGood)
    await runCritiqueStage('Q', drafts, config, p, () => {}, 42)
    for (const req of p.requests) {
      const whole = `${req.system}\n${req.user}`
      expect(whole).not.toMatch(/seat [123]/i)
      expect(whole).not.toMatch(/\bm[123]\b/)
      expect(whole).not.toMatch(/\bL[1234]\b/)
    }
  })

  it('shows each critic exactly the two peer drafts, never its own', async () => {
    const p = makeFakeProvider(allGood)
    await runCritiqueStage('Q', drafts, config, p, () => {}, 42)
    const byModel = new Map(p.requests.map((r) => [r.model, r.user]))
    const m1User = byModel.get('m1')!
    // Own answer is required for revision (spec §4); it must not appear as a peer Draft A/B target.
    expect(m1User).toContain('--- YOUR OWN ANSWER ---')
    expect(m1User).toContain('alpha draft')
    expect(m1User).toContain('beta draft')
    expect(m1User).toContain('gamma draft')
    expect(m1User).not.toMatch(/--- DRAFT [AB] ---\nalpha draft/)
  })

  it('records the peer map so the UI can de-anonymize after the fact', async () => {
    const p = makeFakeProvider(allGood)
    const out = await runCritiqueStage('Q', drafts, config, p, () => {}, 42)
    const critic1 = out.find((c) => c.seatId === 1)!
    expect(new Set(Object.values(critic1.peerMap))).toEqual(new Set([2, 3]))
  })

  it('emits a critique_done event carrying the payload', async () => {
    const p = makeFakeProvider(allGood)
    const events: CouncilEvent[] = []
    await runCritiqueStage('Q', drafts, config, p, (e) => events.push(e), 42)
    const done = events.filter((e) => e.type === 'critique_done')
    expect(done).toHaveLength(3)
    expect(done[0]).toHaveProperty('payload.revised_answer', 'revised')
  })

  it('repairs a critique with an empty gaps array, then accepts the fix', async () => {
    const lazy = JSON.stringify({
      critiques: [
        { target: 'A', strengths: ['s'], gaps: [], risks: ['r'], factual_errors: [] },
        { target: 'B', strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
      ],
      revised_answer: 'revised',
    })
    const p = makeFakeProvider({
      m1: { text: lazy, thenText: goodCritique },
      m2: { text: goodCritique },
      m3: { text: goodCritique },
    })
    const out = await runCritiqueStage('Q', drafts, config, p, () => {}, 42)
    expect(out.find((c) => c.seatId === 1)!.status).toBe('ok')
    expect(p.requests.filter((r) => r.model === 'm1')).toHaveLength(2)
  })

  it('marks a seat failed when it produces invalid json twice', async () => {
    const p = makeFakeProvider({
      m1: { text: '{"nope":1}' },
      m2: { text: goodCritique },
      m3: { text: goodCritique },
    })
    const out = await runCritiqueStage('Q', drafts, config, p, () => {}, 42)
    expect(out.find((c) => c.seatId === 1)!.status).toBe('failed')
    expect(out.filter((c) => c.status === 'ok')).toHaveLength(2)
  })

  it('skips drafters that failed R1 and critiques only surviving peers', async () => {
    const degraded: DraftResult[] = [
      drafts[0],
      { ...drafts[1], status: 'failed', text: '' },
      drafts[2],
    ]
    const p = makeFakeProvider({ m1: { text: goodCritique }, m3: { text: goodCritique } })
    const out = await runCritiqueStage('Q', degraded, config, p, () => {}, 42)
    expect(out.map((c) => c.seatId)).toEqual([1, 3])
  })

  it('requires the critic to find at least one gap and one risk', () => {
    expect(CRITIQUE_SYSTEM).toMatch(/at least one gap/i)
    expect(CRITIQUE_SYSTEM).toMatch(/at least one risk/i)
  })
})
