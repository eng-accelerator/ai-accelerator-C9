import { describe, it, expect } from 'vitest'
import { runCouncil } from '@/council/orchestrator'
import { makeFakeProvider } from '@/council/providers/fake'
import type { CouncilEvent } from '@/council/events'
import type { CouncilConfig } from '@/council/config'

const config: CouncilConfig = {
  drafters: [
    { id: 1, model: 'm1', label: 'Seat 1', lab: 'L1' },
    { id: 2, model: 'm2', label: 'Seat 2', lab: 'L2' },
    { id: 3, model: 'm3', label: 'Seat 3', lab: 'L3' },
  ],
  judge: { id: 0, model: 'mj', label: 'Judge', lab: 'L4' },
  timeoutMs: 1000,
}

const critique = JSON.stringify({
  critiques: [
    { target: 'A', strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
    { target: 'B', strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
  ],
  revised_answer: 'revised',
})

const verdict = JSON.stringify({
  answer_markdown: '# Final',
  provenance: [{ claim: 'c', support: 'unanimous', seats: [1, 2, 3] }],
  contested: [],
  confidence: 'high',
})

// Drafters are called twice: once to stream a draft, once to critique.
const healthy = {
  m1: { text: 'draft one', thenText: critique },
  m2: { text: 'draft two', thenText: critique },
  m3: { text: 'draft three', thenText: critique },
  mj: { text: verdict },
}

function collect() {
  const events: CouncilEvent[] = []
  return { events, emit: (e: CouncilEvent) => events.push(e) }
}

describe('runCouncil', () => {
  it('completes a healthy run and returns a verdict', async () => {
    const { emit } = collect()
    const run = await runCouncil('Q', config, makeFakeProvider(healthy), emit, { runId: 'r1', seed: 1 })
    expect(run.status).toBe('complete')
    expect(run.verdict!.answer_markdown).toBe('# Final')
  })

  it('emits stages in protocol order: draft, critique, judge', async () => {
    const { events, emit } = collect()
    await runCouncil('Q', config, makeFakeProvider(healthy), emit, { runId: 'r1', seed: 1 })
    const stages = events.filter((e) => e.type === 'stage_started').map((e) => e.stage)
    expect(stages).toEqual(['draft', 'critique', 'judge'])
  })

  it('brackets the run with run_started and run_done', async () => {
    const { events, emit } = collect()
    await runCouncil('Q', config, makeFakeProvider(healthy), emit, { runId: 'r1', seed: 1 })
    expect(events[0]).toMatchObject({ type: 'run_started', runId: 'r1' })
    expect(events.at(-1)).toMatchObject({ type: 'run_done', runId: 'r1' })
  })

  it('sums usage across every seat and every stage', async () => {
    const { emit } = collect()
    const run = await runCouncil('Q', config, makeFakeProvider(healthy), emit, { runId: 'r1', seed: 1 })
    // 3 drafts + 3 critiques + 1 judge = 7 calls at 100/50 tokens each
    expect(run.usage.promptTokens).toBe(700)
    expect(run.usage.completionTokens).toBe(350)
  })

  it('marks the run degraded when one drafter fails but quorum holds', async () => {
    const { emit } = collect()
    const run = await runCouncil('Q', config, makeFakeProvider({ ...healthy, m2: { error: 'boom' } }), emit, { runId: 'r1', seed: 1 })
    expect(run.status).toBe('degraded')
    expect(run.verdict).not.toBeNull()
  })

  it('fails the run when two drafters fail, breaching quorum', async () => {
    const { events, emit } = collect()
    const run = await runCouncil(
      'Q',
      config,
      makeFakeProvider({ ...healthy, m2: { error: 'boom' }, m3: { error: 'boom' } }),
      emit,
      { runId: 'r1', seed: 1 },
    )
    expect(run.status).toBe('failed')
    expect(run.verdict).toBeNull()
    expect(run.error).toMatch(/quorum/i)
    expect(events.some((e) => e.type === 'run_failed')).toBe(true)
  })

  it('never calls the judge when quorum is breached', async () => {
    const p = makeFakeProvider({ ...healthy, m2: { error: 'boom' }, m3: { error: 'boom' } })
    await runCouncil('Q', config, p, () => {}, { runId: 'r1', seed: 1 })
    expect(p.requests.some((r) => r.model === 'mj')).toBe(false)
  })

  it('fails the run when the judge fails, without promoting a drafter', async () => {
    const p = makeFakeProvider({ ...healthy, mj: { error: 'judge down' } })
    const run = await runCouncil('Q', config, p, () => {}, { runId: 'r1', seed: 1 })
    expect(run.status).toBe('failed')
    expect(run.verdict).toBeNull()
    // No second judge attempt against a drafter model after the judge failed.
    expect(p.requests.filter((r) => r.model === 'm1')).toHaveLength(2)
  })

  it('is deterministic given a seed', async () => {
    const a = await runCouncil('Q', config, makeFakeProvider(healthy), () => {}, { runId: 'r', seed: 5 })
    const b = await runCouncil('Q', config, makeFakeProvider(healthy), () => {}, { runId: 'r', seed: 5 })
    expect(a.stages.critiques.map((c) => c.peerMap)).toEqual(b.stages.critiques.map((c) => c.peerMap))
  })

  it('records elapsed time', async () => {
    const run = await runCouncil('Q', config, makeFakeProvider(healthy), () => {}, { runId: 'r1', seed: 1 })
    expect(run.elapsedMs).toBeGreaterThanOrEqual(0)
  })
})
