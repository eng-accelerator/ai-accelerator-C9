import { describe, it, expect } from 'vitest'
import { runJudgeStage, verifyConfidence, JUDGE_SYSTEM } from '@/council/stages/judge'
import { makeFakeProvider } from '@/council/providers/fake'
import type { Verdict } from '@/council/schemas'
import type { DraftResult } from '@/council/stages/draft'
import type { CritiqueResult } from '@/council/stages/critique'
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

const ZU = { promptTokens: 0, completionTokens: 0, costUsd: 0 }
const drafts: DraftResult[] = [1, 2, 3].map((id) => ({
  seatId: id, model: `m${id}`, label: `Seat ${id}`, text: `draft ${id}`, usage: ZU, status: 'ok' as const,
}))
const critiques: CritiqueResult[] = [1, 2, 3].map((id) => ({
  seatId: id, model: `m${id}`, peerMap: {}, usage: ZU, status: 'ok' as const,
  payload: {
    critiques: [
      { target: 'A' as const, strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
      { target: 'B' as const, strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
    ],
    revised_answer: `revision ${id}`,
  },
}))

function verdictWith(support: Array<'unanimous' | 'majority' | 'single'>, confidence: string) {
  return JSON.stringify({
    answer_markdown: '# Answer',
    provenance: support.map((s, i) => ({ claim: `c${i}`, support: s, seats: [1] })),
    contested: [],
    confidence,
  })
}

describe('verifyConfidence', () => {
  const base = { answer_markdown: 'a', contested: [], provenance: [] }

  it('leaves high confidence alone when claims are well supported', () => {
    const v = { ...base, confidence: 'high', provenance: [
      { claim: 'a', support: 'unanimous' as const, seats: [1, 2, 3] },
      { claim: 'b', support: 'unanimous' as const, seats: [1, 2, 3] },
      { claim: 'c', support: 'majority' as const, seats: [1, 2] },
    ] } as Verdict
    expect(verifyConfidence(v).adjusted).toBe(false)
    expect(verifyConfidence(v).verdict.confidence).toBe('high')
  })

  it('downgrades high to medium when over a third of claims are single-seat', () => {
    const v = { ...base, confidence: 'high', provenance: [
      { claim: 'a', support: 'single' as const, seats: [1] },
      { claim: 'b', support: 'single' as const, seats: [2] },
      { claim: 'c', support: 'unanimous' as const, seats: [1, 2, 3] },
    ] } as Verdict
    const out = verifyConfidence(v)
    expect(out.adjusted).toBe(true)
    expect(out.verdict.confidence).toBe('medium')
  })

  it('does not upgrade a conservative verdict', () => {
    const v = { ...base, confidence: 'low', provenance: [
      { claim: 'a', support: 'unanimous' as const, seats: [1, 2, 3] },
    ] } as Verdict
    expect(verifyConfidence(v).verdict.confidence).toBe('low')
    expect(verifyConfidence(v).adjusted).toBe(false)
  })

  it('leaves an empty provenance list alone rather than dividing by zero', () => {
    const v = { ...base, confidence: 'high', provenance: [] } as Verdict
    expect(() => verifyConfidence(v)).not.toThrow()
    expect(verifyConfidence(v).adjusted).toBe(false)
  })
})

describe('runJudgeStage', () => {
  it('returns a parsed verdict', async () => {
    const p = makeFakeProvider({ mj: { text: verdictWith(['unanimous'], 'high') } })
    const out = await runJudgeStage('Q', drafts, critiques, config, p, () => {})
    expect(out.status).toBe('ok')
    expect(out.verdict!.answer_markdown).toBe('# Answer')
  })

  it('never places a model name or lab in the judge prompt', async () => {
    const p = makeFakeProvider({ mj: { text: verdictWith(['unanimous'], 'high') } })
    await runJudgeStage('Q', drafts, critiques, config, p, () => {})
    const req = p.requests[0]
    const whole = `${req.system}\n${req.user}`
    expect(whole).not.toMatch(/\bm[123]\b/)
    expect(whole).not.toMatch(/\bL[1234]\b/)
  })

  it('shows the judge drafts, critiques, and revisions', async () => {
    const p = makeFakeProvider({ mj: { text: verdictWith(['unanimous'], 'high') } })
    await runJudgeStage('Q', drafts, critiques, config, p, () => {})
    const user = p.requests[0].user
    expect(user).toContain('draft 1')
    expect(user).toContain('revision 2')
    expect(user).toMatch(/critique/i)
  })

  it('scrubs self-references from drafts and revisions in the judge prompt', async () => {
    const leakyDrafts: DraftResult[] = [
      {
        seatId: 1,
        model: 'm1',
        label: 'Seat 1',
        text: 'As Claude, I would say quorum is two.',
        usage: ZU,
        status: 'ok',
      },
      {
        seatId: 2,
        model: 'm2',
        label: 'Seat 2',
        text: 'I am ChatGPT, an AI made by OpenAI. Quorum is two.',
        usage: ZU,
        status: 'ok',
      },
      {
        seatId: 3,
        model: 'm3',
        label: 'Seat 3',
        text: 'Speaking as Gemini, built by Google DeepMind, two drafters.',
        usage: ZU,
        status: 'ok',
      },
    ]
    const leakyCritiques: CritiqueResult[] = [
      {
        seatId: 1,
        model: 'm1',
        peerMap: { A: 2, B: 3 },
        usage: ZU,
        status: 'ok',
        payload: {
          critiques: [
            { target: 'A', strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
            { target: 'B', strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
          ],
          revised_answer: 'As an Anthropic model, I conclude quorum is two.',
        },
      },
      {
        seatId: 2,
        model: 'm2',
        peerMap: { A: 1, B: 3 },
        usage: ZU,
        status: 'ok',
        payload: {
          critiques: [
            { target: 'A', strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
            { target: 'B', strengths: ['s'], gaps: ['g'], risks: ['r'], factual_errors: [] },
          ],
          revised_answer: 'I am Grok, made by xAI. Quorum remains two.',
        },
      },
    ]

    const p = makeFakeProvider({ mj: { text: verdictWith(['unanimous'], 'high') } })
    await runJudgeStage('Q', leakyDrafts, leakyCritiques, config, p, () => {})
    const user = p.requests[0].user
    expect(user).not.toMatch(/claude|chatgpt|gemini|grok|openai|anthropic|deepmind|xai/i)
    expect(user).toContain('quorum is two')
  })

  it('flags a downgraded confidence on the result', async () => {
    const p = makeFakeProvider({ mj: { text: verdictWith(['single', 'single', 'unanimous'], 'high') } })
    const out = await runJudgeStage('Q', drafts, critiques, config, p, () => {})
    expect(out.confidenceAdjusted).toBe(true)
    expect(out.verdict!.confidence).toBe('medium')
  })

  it('fails the run when the judge produces invalid json twice — no fallback', async () => {
    const p = makeFakeProvider({ mj: { text: '{"garbage":true}' } })
    const out = await runJudgeStage('Q', drafts, critiques, config, p, () => {})
    expect(out.status).toBe('failed')
    expect(out.verdict).toBeNull()
  })

  it('instructs the judge to synthesize rather than pick a winner', () => {
    expect(JUDGE_SYSTEM).toMatch(/synthes/i)
    expect(JUDGE_SYSTEM).toMatch(/contested/i)
  })
})
