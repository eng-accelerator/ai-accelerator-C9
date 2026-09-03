export type Draft = { seatId: number; text: string }
export type LabeledPeer = { label: 'A' | 'B'; seatId: number; text: string }

// Deterministic PRNG (mulberry32) so shuffles are reproducible in tests
// and per-run in production.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LAB_TERMS = 'claude|chatgpt|gpt-?[0-9.]*|gemini|grok|llama|openai|anthropic|google deepmind|deepmind|xai|x\\.ai'

// Only first-person self-identification is stripped. Third-person mentions
// survive, because a query genuinely about these companies must still work.
//
// Patterns are ordered most-specific first: bare `\bas LAB` must not run
// before `speaking as LAB`, and `I am` clauses that keep an "an AI" descriptor
// must not swallow that descriptor as if it were a lab name (xAI contains "AI").
const SELF_ID_PATTERNS: Array<{ re: RegExp; repl: string }> = [
  {
    re: new RegExp(
      `\\bspeaking as (?:${LAB_TERMS})(?:\\s*,\\s*(?:made|built|created|trained) by [a-z ]*?(?:${LAB_TERMS}))?\\s*,?\\s*`,
      'gi',
    ),
    repl: '',
  },
  // I am NAME, made/built by LAB. (no mid descriptor)
  {
    re: new RegExp(
      `\\bi am (?:an? )?(?:${LAB_TERMS})\\s*,\\s*(?:made|built|created|trained) by [a-z ]*?(?:${LAB_TERMS})\\s*\\.?\\s*`,
      'gi',
    ),
    repl: '',
  },
  // I am NAME, an AI/model made by LAB. — keep the descriptor
  {
    re: new RegExp(
      `\\bi am (?:an? )?(?:${LAB_TERMS})\\s*,\\s*((?:an? )?[a-z ]*?(?:model|ai|assistant))\\s+(?:made|built|created|trained) by [a-z ]*?(?:${LAB_TERMS})\\s*\\.?\\s*`,
      'gi',
    ),
    repl: '$1',
  },
  // I am NAME, an AI/model.
  {
    re: new RegExp(
      `\\bi am (?:an? )?(?:${LAB_TERMS})\\s*,\\s*((?:an? )?[a-z ]*?(?:model|ai|assistant))\\s*\\.?\\s*`,
      'gi',
    ),
    repl: '$1',
  },
  // Bare I am NAME.
  {
    re: new RegExp(`\\bi am (?:an? )?(?:${LAB_TERMS})\\s*\\.?\\s*`, 'gi'),
    repl: '',
  },
  {
    re: new RegExp(`\\bas (?:an? )?(?:${LAB_TERMS}) model\\s*,?\\s*`, 'gi'),
    repl: '',
  },
  {
    re: new RegExp(
      `\\bas (?:an? )?(?:${LAB_TERMS})(?:[ ,-]+(?:an? )?[a-z ]*?model)?\\s*,?\\s*`,
      'gi',
    ),
    repl: '',
  },
]

export function scrubSelfReferences(text: string): string {
  let out = text
  for (const { re, repl } of SELF_ID_PATTERNS) out = out.replace(re, repl)
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * Present peer drafts to one critic as `Draft A` / `Draft B`.
 *
 * The A/B assignment is shuffled independently per critic per run, so
 * ordinal position never correlates with seat identity (spec 4.2). The
 * returned `seatId` is for the orchestrator and the UI only — it is never
 * placed in a prompt.
 */
export function anonymizePeers(
  drafts: Draft[],
  criticSeatId: number,
  rand: () => number,
): LabeledPeer[] {
  const peers = drafts.filter((d) => d.seatId !== criticSeatId)

  // Fisher-Yates with the injected RNG.
  const shuffled = [...peers]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const labels: Array<'A' | 'B'> = ['A', 'B']
  return shuffled.map((d, i) => ({
    label: labels[i],
    seatId: d.seatId,
    text: scrubSelfReferences(d.text),
  }))
}
