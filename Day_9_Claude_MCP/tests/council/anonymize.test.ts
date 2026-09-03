import { describe, it, expect } from 'vitest'
import { scrubSelfReferences, anonymizePeers, makeRng, type Draft } from '@/council/anonymize'

describe('scrubSelfReferences', () => {
  const cases: Array<[string, string]> = [
    ['As Claude, I would say the sky is blue.', 'the sky is blue'],
    ['I am ChatGPT, an AI made by OpenAI.', 'an AI'],
    ['Speaking as Gemini, built by Google DeepMind, here is my take.', 'here is my take'],
    ['I am Grok, made by xAI.', ''],
    ['As an Anthropic model, I must note...', 'I must note'],
  ]

  for (const [input, mustSurvive] of cases) {
    it(`removes the self-reference from: ${input.slice(0, 32)}...`, () => {
      const out = scrubSelfReferences(input)
      expect(out).not.toMatch(/claude|chatgpt|gemini|grok|openai|anthropic|deepmind|xai/i)
      if (mustSurvive) expect(out).toContain(mustSurvive)
    })
  }

  it('leaves ordinary prose untouched', () => {
    const text = 'Use Postgres with a read replica. Measure p99 before optimizing.'
    expect(scrubSelfReferences(text)).toBe(text)
  })

  it('does not scrub lab names that are the actual subject of the query', () => {
    // A query genuinely about these companies must survive. We only strip
    // first-person self-identification, not third-person mentions.
    const text = 'Anthropic and OpenAI both publish model cards.'
    expect(scrubSelfReferences(text)).toBe(text)
  })
})

const drafts: Draft[] = [
  { seatId: 1, text: 'alpha answer' },
  { seatId: 2, text: 'beta answer' },
  { seatId: 3, text: 'gamma answer' },
]

describe('anonymizePeers', () => {
  it('excludes the critic own draft', () => {
    const peers = anonymizePeers(drafts, 2, makeRng(1))
    expect(peers.map((p) => p.seatId)).not.toContain(2)
    expect(peers).toHaveLength(2)
  })

  it('labels peers A and B only', () => {
    const peers = anonymizePeers(drafts, 1, makeRng(1))
    expect(peers.map((p) => p.label).sort()).toEqual(['A', 'B'])
  })

  it('never emits the seat id into the label', () => {
    for (const critic of [1, 2, 3]) {
      const peers = anonymizePeers(drafts, critic, makeRng(critic))
      for (const p of peers) expect(p.label).not.toMatch(/\d/)
    }
  })

  it('shuffles independently per critic, so position does not encode identity', () => {
    // Across many seeds, seat 3 must land on label A sometimes and B other
    // times. A fixed mapping would make label position a reliable identity leak.
    const labelsForSeat3 = new Set<string>()
    for (let seed = 0; seed < 50; seed++) {
      const peers = anonymizePeers(drafts, 1, makeRng(seed))
      const p3 = peers.find((p) => p.seatId === 3)!
      labelsForSeat3.add(p3.label)
    }
    expect(labelsForSeat3).toEqual(new Set(['A', 'B']))
  })

  it('is deterministic for a given seed', () => {
    const a = anonymizePeers(drafts, 1, makeRng(7))
    const b = anonymizePeers(drafts, 1, makeRng(7))
    expect(a).toEqual(b)
  })

  it('handles a degraded council of two drafters', () => {
    const twoDrafts: Draft[] = [
      { seatId: 1, text: 'alpha' },
      { seatId: 3, text: 'gamma' },
    ]
    const peers = anonymizePeers(twoDrafts, 1, makeRng(1))
    expect(peers).toHaveLength(1)
    expect(peers[0].label).toBe('A')
    expect(peers[0].seatId).toBe(3)
  })

  it('scrubs self-references from peer text as it labels', () => {
    const leaky: Draft[] = [
      { seatId: 1, text: 'ok' },
      { seatId: 2, text: 'As Claude, I recommend Postgres.' },
    ]
    const peers = anonymizePeers(leaky, 1, makeRng(1))
    expect(peers[0].text).not.toMatch(/claude/i)
    expect(peers[0].text).toContain('Postgres')
  })
})
