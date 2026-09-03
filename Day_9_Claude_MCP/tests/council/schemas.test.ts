import { describe, it, expect } from 'vitest'
import { CritiqueOutputSchema, VerdictSchema } from '@/council/schemas'
import { CouncilConfigSchema, CouncilPostBodySchema, DEFAULT_CONFIG } from '@/council/config'

const validCritique = {
  critiques: [
    { target: 'A', strengths: ['clear'], gaps: ['no cost analysis'], risks: ['assumes uptime'], factual_errors: [] },
    { target: 'B', strengths: ['thorough'], gaps: ['ignores latency'], risks: ['vendor lock-in'], factual_errors: ['claims X is free'] },
  ],
  revised_answer: '# Revised\n\nBetter now.',
}

describe('CritiqueOutputSchema', () => {
  it('accepts a well-formed critique', () => {
    expect(CritiqueOutputSchema.parse(validCritique)).toBeTruthy()
  })

  it('rejects an empty gaps array — a critic cannot pass by saying it looks good', () => {
    const bad = structuredClone(validCritique)
    bad.critiques[0].gaps = []
    expect(() => CritiqueOutputSchema.parse(bad)).toThrow()
  })

  it('rejects an empty risks array', () => {
    const bad = structuredClone(validCritique)
    bad.critiques[1].risks = []
    expect(() => CritiqueOutputSchema.parse(bad)).toThrow()
  })

  it('allows empty factual_errors', () => {
    const ok = structuredClone(validCritique)
    ok.critiques[1].factual_errors = []
    expect(() => CritiqueOutputSchema.parse(ok)).not.toThrow()
  })

  it('accepts one critique, for a degraded two-drafter council', () => {
    const one = structuredClone(validCritique)
    one.critiques.pop()
    expect(() => CritiqueOutputSchema.parse(one)).not.toThrow()
  })

  it('rejects zero critiques', () => {
    const none = structuredClone(validCritique)
    none.critiques = []
    expect(() => CritiqueOutputSchema.parse(none)).toThrow()
  })

  it('rejects more critiques than there are peers', () => {
    const three = structuredClone(validCritique)
    three.critiques.push(structuredClone(three.critiques[0]))
    expect(() => CritiqueOutputSchema.parse(three)).toThrow()
  })

  it('rejects duplicate critique targets', () => {
    const dup = structuredClone(validCritique)
    dup.critiques[1].target = 'A'
    expect(() => CritiqueOutputSchema.parse(dup)).toThrow()
  })

  it('rejects a non-empty revised_answer requirement violation', () => {
    const bad = structuredClone(validCritique)
    bad.revised_answer = ''
    expect(() => CritiqueOutputSchema.parse(bad)).toThrow()
  })
})

const validVerdict = {
  answer_markdown: '# Answer',
  provenance: [{ claim: 'X is true', support: 'unanimous', seats: [1, 2, 3] }],
  contested: [
    { point: 'Y', positions: [{ seat: 1, position: 'yes' }, { seat: 2, position: 'no' }], ruling: 'yes', reasoning: 'evidence' },
  ],
  confidence: 'high',
}

describe('VerdictSchema', () => {
  it('accepts a well-formed verdict', () => {
    expect(VerdictSchema.parse(validVerdict)).toBeTruthy()
  })

  it('rejects an unknown support level', () => {
    const bad = structuredClone(validVerdict)
    bad.provenance[0].support = 'probably'
    expect(() => VerdictSchema.parse(bad)).toThrow()
  })

  it('rejects an unknown confidence level', () => {
    const bad = structuredClone(validVerdict)
    bad.confidence = 'certain'
    expect(() => VerdictSchema.parse(bad)).toThrow()
  })

  it('allows an empty contested array — unanimous councils exist', () => {
    const ok = structuredClone(validVerdict)
    ok.contested = []
    expect(() => VerdictSchema.parse(ok)).not.toThrow()
  })
})

describe('DEFAULT_CONFIG', () => {
  it('has three drafters and one judge', () => {
    expect(DEFAULT_CONFIG.drafters).toHaveLength(3)
    expect(DEFAULT_CONFIG.judge).toBeTruthy()
  })

  it('draws every seat from a different lab, so no lab both drafts and judges', () => {
    const labs = [...DEFAULT_CONFIG.drafters.map((s) => s.lab), DEFAULT_CONFIG.judge.lab]
    expect(new Set(labs).size).toBe(4)
  })

  it('assigns stable sequential seat ids', () => {
    expect(DEFAULT_CONFIG.drafters.map((s) => s.id)).toEqual([1, 2, 3])
  })
})

describe('CouncilPostBodySchema', () => {
  const seat = { id: 1, model: 'm', label: 'Seat 1', lab: 'L' }

  it('accepts query-only bodies and leaves config optional', () => {
    const out = CouncilPostBodySchema.parse({ query: '  hello  ' })
    expect(out.query).toBe('hello')
    expect(out.config).toBeUndefined()
  })

  it('rejects more than three drafters', () => {
    expect(() =>
      CouncilConfigSchema.parse({
        drafters: [seat, { ...seat, id: 2 }, { ...seat, id: 3 }, { ...seat, id: 4 }],
        judge: { ...seat, id: 0 },
        timeoutMs: 90_000,
      }),
    ).toThrow()
  })

  it('clamps timeoutMs into 1000–180000', () => {
    expect(
      CouncilConfigSchema.parse({
        drafters: [seat],
        judge: { ...seat, id: 0 },
        timeoutMs: 50,
      }).timeoutMs,
    ).toBe(1000)
    expect(
      CouncilConfigSchema.parse({
        drafters: [seat],
        judge: { ...seat, id: 0 },
        timeoutMs: 999_999,
      }).timeoutMs,
    ).toBe(180_000)
  })
})
