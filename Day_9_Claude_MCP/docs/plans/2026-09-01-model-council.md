# Model Council Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js app that runs one query through four models from four labs — three write independent drafts, cross-critique each other blind, and revise; a fourth judges — and returns a synthesized answer with provenance and an explicit contested section.

**Architecture:** A pure async orchestrator drives a three-round protocol over a narrow `Provider` interface, so the entire council engine is testable with deterministic fakes and never touches HTTP. A thin SSE route adapts the orchestrator to the browser. One Prisma table stores runs as JSON blobs. The UI is a CRT phosphor-green terminal driven entirely by CSS custom properties.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript 7 · Zod 4 · Prisma 7 (SQLite dev / Postgres prod) · Vitest 4 · OpenRouter

**Spec:** `docs/specs/2026-09-01-model-council-design.md` — read it alongside this plan. Every task argues from a numbered section of the spec.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- **Runtime:** Node runtime for the SSE route, never Edge — run durations exceed Edge limits (spec §14).
- **The `Provider` seam is absolute.** `council/orchestrator.ts` and everything under `council/stages/` must never import `fetch`, `process.env`, or any OpenRouter symbol. Only `council/providers/openrouter.ts` knows about HTTP (spec §6.1).
- **Quorum: 2 drafters + judge.** Below that the run is `failed` and no verdict is produced (spec §10).
- **No fallback judge.** If the judge fails after retry, the run is `failed`. Never promote a drafter (spec §10).
- **Anonymization applies to prompts only.** The user always sees which model holds which seat; the models never do (spec §4.2).
- **Critique schema enforces >= 1 `gap` and >= 1 `risk` per peer.** Empty arrays fail validation and trigger repair (spec §4.2, §7.1).
- **Exactly one JSON repair round-trip.** A second validation failure fails that seat (spec §7).
- **Only R1 streams tokens.** Critique and judge are single structured calls (spec §9).
- **Palette is fixed and complete.** Phosphor `#39ff7a`, support `#2bbf5c` / `#1c7a3c`, sage `#5f8d68`, near-white `#eafff1`, panels `#050805` / `#070b07`, hairlines `#143614` / `#1f4d1f`, amber `#ffd24a` (semantic: contested/attention), red `#ff5f56` (failed seats). **No purple or indigo anywhere.** Radii 3–8px only (spec §11.1).
- **Monospace only.** JetBrains Mono + IBM Plex Mono via `next/font/google`. Hierarchy from size, weight, and glow — never a second typeface (spec §11.1).
- **The ~60px banner must be a class with explicit `font-size !important`** — preview hosts override bare `h1` (spec §11.1).
- **No purple/indigo, no Inter, no emoji headings, no stock imagery, no centered-everything layout.** Left-aligned and command-driven (spec §11.1).

## File Structure

| File | Responsibility |
| --- | --- |
| `council/config.ts` | Default roster, tunables. No logic. |
| `council/schemas.ts` | Zod schemas for every structured model output. |
| `council/anonymize.ts` | Shuffle, relabel, scrub self-references. The correctness core. |
| `council/providers/types.ts` | `Provider` interface and payload types. Zero implementation. |
| `council/providers/openrouter.ts` | The only module that knows HTTP, keys, and vendor shapes. |
| `council/providers/fake.ts` | Deterministic providers for tests. |
| `council/call.ts` | Timeout, retry, and the one JSON repair round-trip. |
| `council/stages/draft.ts` | R1. Parallel streaming drafts. |
| `council/stages/critique.ts` | R2. Blind critique + self-revision. |
| `council/stages/judge.ts` | R3. Verdict + confidence verification. |
| `council/orchestrator.ts` | Stage sequencing, quorum, usage accounting, event emission. |
| `council/events.ts` | The SSE event union. Shared by orchestrator and UI. |
| `lib/db.ts` | Prisma client singleton + run repository. |
| `app/api/council/route.ts` | Orchestrator → SSE adapter. Thin. |
| `app/api/models/route.ts` | Cached OpenRouter catalog proxy. |
| `styles/theme.css` | Every design token as a CSS custom property. |
| `components/terminal/*` | Frame, scanline, prompt, caret, meter, panel primitives. |
| `app/page.tsx` | Screen 1 — query + roster. |
| `components/deliberation/*` | Screen 2 — live streaming columns. |
| `app/run/[id]/page.tsx` | Screen 3 — shareable verdict. |

Files that change together live together: each stage owns its prompt inline rather than in a separate `prompts/` tree, since a prompt and the parser that consumes it are a single unit of change. This is a deliberate simplification of the spec's §6 tree.

---

### Task 1: Scaffold, theme tokens, and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `.gitignore`
- Create: `styles/theme.css`, `app/layout.tsx`, `app/globals.css`
- Test: `tests/theme.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a working `npm test` and `npm run dev`; CSS custom properties `--phosphor`, `--phosphor-dim`, `--phosphor-faint`, `--sage`, `--ink`, `--panel`, `--panel-lift`, `--hairline`, `--hairline-bright`, `--amber`, `--danger` consumed by every UI task.

- [ ] **Step 1: Initialize the project and install dependencies**

```bash
cd model-council
npm init -y
npm pkg set name="model-council" private=true type="module"
npm pkg set scripts.dev="next dev" scripts.build="next build" scripts.start="next start"
npm pkg set scripts.test="vitest run" scripts.test:watch="vitest"
npm install next@16.3.4 react@19.2.8 react-dom@19.2.8 zod@4.5.4 @prisma/client@7.10.0
npm install -D typescript@7.0.2 @types/node @types/react @types/react-dom vitest@4.1.11 prisma@7.10.0
```

- [ ] **Step 2: Write the config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "skipLibCheck": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
})
```

`next.config.ts`:
```ts
import type { NextConfig } from 'next'
const config: NextConfig = {}
export default config
```

`.gitignore`:
```
node_modules
.next
.env
*.db
*.db-journal
```

`.env.example`:
```
OPENROUTER_API_KEY=
DATABASE_URL="file:./dev.db"
COUNCIL_TIMEOUT_MS=90000
RUN_LIVE_TESTS=
```

- [ ] **Step 3: Write the failing theme test**

The palette is a hard constraint, so it gets a test. This catches the single most likely drift — someone introducing a purple.

`tests/theme.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('styles/theme.css', 'utf8')

describe('theme tokens', () => {
  const required: Record<string, string> = {
    '--phosphor': '#39ff7a',
    '--phosphor-dim': '#2bbf5c',
    '--phosphor-faint': '#1c7a3c',
    '--sage': '#5f8d68',
    '--ink': '#eafff1',
    '--panel': '#050805',
    '--panel-lift': '#070b07',
    '--hairline': '#143614',
    '--hairline-bright': '#1f4d1f',
    '--amber': '#ffd24a',
    '--danger': '#ff5f56',
  }

  for (const [token, value] of Object.entries(required)) {
    it(`defines ${token} as ${value}`, () => {
      expect(css).toMatch(new RegExp(`${token}\\s*:\\s*${value}`, 'i'))
    })
  }

  it('contains no purple or indigo', () => {
    const banned = /#(6[0-9a-f]{2}[3-9a-f][0-9a-f]f{2}|[4-9a-f][0-9a-f]{2}[0-9a-f]{2}ff)\b|indigo|purple|violet/i
    expect(css).not.toMatch(banned)
  })

  it('uses only 3-8px radii', () => {
    const radii = [...css.matchAll(/border-radius:\s*(\d+)px/g)].map((m) => Number(m[1]))
    expect(radii.length).toBeGreaterThan(0)
    for (const r of radii) expect(r).toBeGreaterThanOrEqual(3)
    for (const r of radii) expect(r).toBeLessThanOrEqual(8)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/theme.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'styles/theme.css'`

- [ ] **Step 5: Write the theme**

`styles/theme.css`:
```css
:root {
  --phosphor: #39ff7a;
  --phosphor-dim: #2bbf5c;
  --phosphor-faint: #1c7a3c;
  --sage: #5f8d68;
  --ink: #eafff1;
  --panel: #050805;
  --panel-lift: #070b07;
  --hairline: #143614;
  --hairline-bright: #1f4d1f;
  --amber: #ffd24a;
  --danger: #ff5f56;
  --dot-red: #ff5f56;
  --dot-amber: #ffbd2e;
  --dot-green: #27c93f;
  --radius: 8px;
  --radius-sm: 3px;
  --glow: 0 0 8px rgba(57, 255, 122, 0.45), 0 0 24px rgba(57, 255, 122, 0.18);
  --glow-soft: 0 0 6px rgba(57, 255, 122, 0.28);
  --glow-amber: 0 0 8px rgba(255, 210, 74, 0.45);
}

.glow { text-shadow: var(--glow); }
.glow-soft { text-shadow: var(--glow-soft); }

::selection { background: rgba(57, 255, 122, 0.3); color: var(--ink); }

/* Fixed CRT scanline overlay — spec 11.1 */
.crt-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
  opacity: 0.5;
  mix-blend-mode: multiply;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 2px,
    rgba(0, 0, 0, 0.16) 3px,
    transparent 4px
  );
}

@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
.caret {
  display: inline-block;
  width: 0.55em;
  height: 1em;
  background: var(--phosphor);
  box-shadow: var(--glow-soft);
  vertical-align: text-bottom;
  animation: blink 1.1s step-end infinite;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
}
```

`app/globals.css`:
```css
@import '../styles/theme.css';

* { box-sizing: border-box; }

body {
  margin: 0;
  background: #000000;
  color: var(--sage);
  font-family: var(--font-jetbrains), var(--font-plex), ui-monospace, monospace;
  font-size: 14px;
  line-height: 1.6;
  background-image:
    radial-gradient(60rem 40rem at 100% 0%, rgba(57, 255, 122, 0.08), transparent 60%),
    radial-gradient(50rem 40rem at 0% 40%, rgba(57, 255, 122, 0.05), transparent 60%);
  background-attachment: fixed;
}
```

- [ ] **Step 6: Write the root layout**

`app/layout.tsx`:
```tsx
import type { Metadata } from 'next'
import { JetBrains_Mono, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-jetbrains',
})
const plex = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex',
})

export const metadata: Metadata = {
  title: 'Model Council',
  description: 'Four models. One verdict.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jetbrains.variable} ${plex.variable}`}>
      <body>
        <div className="crt-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/theme.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with CRT terminal theme tokens"
```

---

### Task 2: Roster config and Zod schemas

**Files:**
- Create: `council/config.ts`, `council/schemas.ts`
- Test: `tests/council/schemas.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Seat = { id: number; model: string; label: string; lab: string }`
  - `type CouncilConfig = { drafters: Seat[]; judge: Seat; timeoutMs: number }`
  - `const DEFAULT_CONFIG: CouncilConfig`
  - `CritiqueOutputSchema`, `type CritiqueOutput`
  - `VerdictSchema`, `type Verdict`

- [ ] **Step 1: Write the failing schema test**

The schema is where the adversarial critique contract is enforced (spec §4.2). These tests are that contract.

`tests/council/schemas.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { CritiqueOutputSchema, VerdictSchema } from '@/council/schemas'
import { DEFAULT_CONFIG } from '@/council/config'

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/council/schemas.test.ts`
Expected: FAIL — cannot resolve `@/council/schemas`

- [ ] **Step 3: Write the config**

`council/config.ts`:
```ts
export type Seat = {
  id: number
  model: string
  label: string
  lab: string
}

export type CouncilConfig = {
  drafters: Seat[]
  judge: Seat
  timeoutMs: number
}

// Verified against the OpenRouter catalog on 2026-09-01 — spec section 5.
// Four labs, so no lab both drafts and judges.
export const DEFAULT_CONFIG: CouncilConfig = {
  drafters: [
    { id: 1, model: 'anthropic/claude-sonnet-5', label: 'Seat 1', lab: 'Anthropic' },
    { id: 2, model: 'openai/gpt-5.4', label: 'Seat 2', lab: 'OpenAI' },
    { id: 3, model: 'google/gemini-3.1-pro-preview', label: 'Seat 3', lab: 'Google' },
  ],
  judge: { id: 0, model: 'x-ai/grok-4.6', label: 'Judge', lab: 'xAI' },
  timeoutMs: Number(process.env.COUNCIL_TIMEOUT_MS ?? 90_000),
}

export const QUORUM_MIN_DRAFTERS = 2
```

- [ ] **Step 4: Write the schemas**

`council/schemas.ts`:
```ts
import { z } from 'zod'

const NonEmpty = z.string().min(1)

// Spec 4.2: at minimum one gap and one risk per peer. A critic cannot pass
// by saying the peer looks good. Empty arrays fail validation and trigger
// exactly one repair round-trip.
export const PeerCritiqueSchema = z.object({
  target: z.enum(['A', 'B']),
  strengths: z.array(NonEmpty).min(1),
  gaps: z.array(NonEmpty).min(1),
  risks: z.array(NonEmpty).min(1),
  factual_errors: z.array(NonEmpty),
})

// One entry per peer shown. A full council shows 2 peers; a degraded council
// of 2 drafters shows 1. Fixing this at 2 would fail every degraded run.
export const CritiqueOutputSchema = z.object({
  critiques: z.array(PeerCritiqueSchema).min(1).max(2),
  revised_answer: NonEmpty,
})

export const ProvenanceEntrySchema = z.object({
  claim: NonEmpty,
  support: z.enum(['unanimous', 'majority', 'single']),
  seats: z.array(z.number().int()),
})

export const ContestedEntrySchema = z.object({
  point: NonEmpty,
  positions: z.array(z.object({ seat: z.number().int(), position: NonEmpty })).min(2),
  ruling: NonEmpty,
  reasoning: NonEmpty,
})

export const VerdictSchema = z.object({
  answer_markdown: NonEmpty,
  provenance: z.array(ProvenanceEntrySchema),
  contested: z.array(ContestedEntrySchema),
  confidence: z.enum(['high', 'medium', 'low']),
})

export type PeerCritique = z.infer<typeof PeerCritiqueSchema>
export type CritiqueOutput = z.infer<typeof CritiqueOutputSchema>
export type Verdict = z.infer<typeof VerdictSchema>
export type Confidence = Verdict['confidence']
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/council/schemas.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 6: Commit**

```bash
git add council/config.ts council/schemas.ts tests/council/schemas.test.ts
git commit -m "feat: roster config and Zod schemas with adversarial critique contract"
```

---

### Task 3: Anonymization

This is the correctness core of the whole product. If a seat identity leaks into a critic's prompt, the council's central claim — that critique targets content, not brand — is false. It gets the most test cases in the plan.

**Files:**
- Create: `council/anonymize.ts`
- Test: `tests/council/anonymize.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Draft = { seatId: number; text: string }`
  - `type LabeledPeer = { label: 'A' | 'B'; seatId: number; text: string }`
  - `function scrubSelfReferences(text: string): string`
  - `function anonymizePeers(drafts: Draft[], criticSeatId: number, rand: () => number): LabeledPeer[]`
  - `function makeRng(seed: number): () => number`

- [ ] **Step 1: Write the failing anonymization test**

`tests/council/anonymize.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/council/anonymize.test.ts`
Expected: FAIL — cannot resolve `@/council/anonymize`

- [ ] **Step 3: Write the implementation**

`council/anonymize.ts`:
```ts
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
const SELF_ID_PATTERNS: RegExp[] = [
  new RegExp(`\\bas (?:an? )?(?:${LAB_TERMS})(?:[ ,-]+(?:an? )?[a-z ]*?model)?\\s*,?\\s*`, 'gi'),
  new RegExp(`\\bi am (?:an? )?(?:${LAB_TERMS})(?:\\s*,\\s*(?:an? )?[a-z ]*?(?:model|ai|assistant))?(?:\\s+(?:made|built|created|trained) by [a-z ]*?(?:${LAB_TERMS}))?\\s*\\.?\\s*`, 'gi'),
  new RegExp(`\\bspeaking as (?:${LAB_TERMS})(?:\\s*,\\s*(?:made|built|created|trained) by [a-z ]*?(?:${LAB_TERMS}))?\\s*,?\\s*`, 'gi'),
  new RegExp(`\\bas (?:an? )?(?:${LAB_TERMS}) model\\s*,?\\s*`, 'gi'),
]

export function scrubSelfReferences(text: string): string {
  let out = text
  for (const p of SELF_ID_PATTERNS) out = out.replace(p, '')
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/council/anonymize.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add council/anonymize.ts tests/council/anonymize.test.ts
git commit -m "feat: blind peer anonymization with per-critic shuffle and self-reference scrubbing"
```

---

### Task 4: Provider interface, fake provider, and OpenRouter client

**Files:**
- Create: `council/providers/types.ts`, `council/providers/fake.ts`, `council/providers/openrouter.ts`
- Test: `tests/council/providers.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Usage = { promptTokens: number; completionTokens: number; costUsd: number }`
  - `type Completion = { text: string; usage: Usage; model: string }`
  - `type Delta = { text: string }`
  - `type CompleteRequest = { model: string; system: string; user: string; json?: boolean; signal?: AbortSignal }`
  - `type StreamHandle = AsyncIterable<Delta> & { done: Promise<Completion> }`
  - `interface Provider { complete(req): Promise<Completion>; stream(req): StreamHandle }`
  - `function makeFakeProvider(script: FakeScript): Provider`
  - `function createOpenRouterProvider(apiKey: string): Provider`
  - `const ZERO_USAGE: Usage`, `function addUsage(a: Usage, b: Usage): Usage`

- [ ] **Step 1: Write the failing provider test**

`tests/council/providers.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeFakeProvider, ZERO_USAGE, addUsage } from '@/council/providers/fake'
import { createOpenRouterProvider } from '@/council/providers/openrouter'

describe('addUsage', () => {
  it('sums token counts and cost', () => {
    const a = { promptTokens: 10, completionTokens: 5, costUsd: 0.01 }
    const b = { promptTokens: 3, completionTokens: 7, costUsd: 0.02 }
    expect(addUsage(a, b)).toEqual({ promptTokens: 13, completionTokens: 12, costUsd: 0.03 })
  })

  it('is identity over ZERO_USAGE', () => {
    const a = { promptTokens: 10, completionTokens: 5, costUsd: 0.01 }
    expect(addUsage(a, ZERO_USAGE)).toEqual(a)
  })
})

describe('makeFakeProvider', () => {
  it('returns the scripted text for a model', async () => {
    const p = makeFakeProvider({ 'model-x': { text: 'hello' } })
    const out = await p.complete({ model: 'model-x', system: 's', user: 'u' })
    expect(out.text).toBe('hello')
    expect(out.model).toBe('model-x')
  })

  it('throws the scripted error', async () => {
    const p = makeFakeProvider({ 'model-x': { error: 'boom' } })
    await expect(p.complete({ model: 'model-x', system: 's', user: 'u' })).rejects.toThrow('boom')
  })

  it('streams the scripted text in chunks and resolves done', async () => {
    const p = makeFakeProvider({ 'model-x': { text: 'abcdef', chunkSize: 2 } })
    const handle = p.stream({ model: 'model-x', system: 's', user: 'u' })
    const chunks: string[] = []
    for await (const d of handle) chunks.push(d.text)
    expect(chunks).toEqual(['ab', 'cd', 'ef'])
    expect((await handle.done).text).toBe('abcdef')
  })

  it('records the requests it received, so prompts can be asserted', async () => {
    const p = makeFakeProvider({ 'model-x': { text: 'ok' } })
    await p.complete({ model: 'model-x', system: 'SYS', user: 'USR' })
    expect(p.requests).toHaveLength(1)
    expect(p.requests[0].system).toBe('SYS')
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('createOpenRouterProvider', () => {
  it('sends the api key and the model, and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'anthropic/claude-sonnet-5',
          choices: [{ message: { content: 'the answer' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0004 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const p = createOpenRouterProvider('sk-test')
    const out = await p.complete({ model: 'anthropic/claude-sonnet-5', system: 's', user: 'u' })

    expect(out.text).toBe('the answer')
    expect(out.usage).toEqual({ promptTokens: 100, completionTokens: 50, costUsd: 0.0004 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('openrouter.ai')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body as string).model).toBe('anthropic/claude-sonnet-5')
  })

  it('requests json response_format when json is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: {} }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createOpenRouterProvider('sk-test')
    await p.complete({ model: 'm', system: 's', user: 'u', json: true })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' })
  })

  it('throws a descriptive error on a non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })))
    const p = createOpenRouterProvider('sk-test')
    await expect(p.complete({ model: 'm', system: 's', user: 'u' })).rejects.toThrow(/429/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/council/providers.test.ts`
Expected: FAIL — cannot resolve `@/council/providers/fake`

- [ ] **Step 3: Write the provider types**

`council/providers/types.ts`:
```ts
export type Usage = {
  promptTokens: number
  completionTokens: number
  costUsd: number
}

export type Completion = { text: string; usage: Usage; model: string }
export type Delta = { text: string }

export type CompleteRequest = {
  model: string
  system: string
  user: string
  /** Request response_format: json_object where the model supports it. */
  json?: boolean
  signal?: AbortSignal
}

export type StreamHandle = AsyncIterable<Delta> & { done: Promise<Completion> }

/**
 * The seam that keeps the council engine testable. The orchestrator and
 * every stage depend only on this — never on fetch, env, or OpenRouter.
 */
export interface Provider {
  /** R2, R3 — single structured response. */
  complete(req: CompleteRequest): Promise<Completion>
  /** R1 only — token deltas, resolving to the same Completion when done. */
  stream(req: CompleteRequest): StreamHandle
}

export const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 }

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    costUsd: Number((a.costUsd + b.costUsd).toFixed(6)),
  }
}
```

- [ ] **Step 4: Write the fake provider**

`council/providers/fake.ts`:
```ts
import type { CompleteRequest, Completion, Delta, Provider, StreamHandle } from './types'
import { ZERO_USAGE } from './types'

export { ZERO_USAGE, addUsage } from './types'

export type FakeEntry = {
  text?: string
  error?: string
  chunkSize?: number
  delayMs?: number
  /** Return a different response on the nth call — used for repair tests. */
  thenText?: string
}

export type FakeScript = Record<string, FakeEntry>
export type FakeProvider = Provider & { requests: CompleteRequest[] }

const USAGE = { promptTokens: 100, completionTokens: 50, costUsd: 0.0004 }

export function makeFakeProvider(script: FakeScript): FakeProvider {
  const requests: CompleteRequest[] = []
  const callCounts = new Map<string, number>()

  function resolve(req: CompleteRequest): string {
    const entry = script[req.model]
    if (!entry) throw new Error(`fake provider has no script for model ${req.model}`)
    const n = (callCounts.get(req.model) ?? 0) + 1
    callCounts.set(req.model, n)
    if (entry.error) throw new Error(entry.error)
    if (n > 1 && entry.thenText !== undefined) return entry.thenText
    return entry.text ?? ''
  }

  return {
    requests,
    async complete(req: CompleteRequest): Promise<Completion> {
      requests.push(req)
      const entry = script[req.model]
      if (entry?.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs))
      const text = resolve(req)
      return { text, usage: { ...USAGE }, model: req.model }
    },
    stream(req: CompleteRequest): StreamHandle {
      requests.push(req)
      const entry = script[req.model]
      let settle: (c: Completion) => void = () => {}
      let fail: (e: unknown) => void = () => {}
      const done = new Promise<Completion>((res, rej) => {
        settle = res
        fail = rej
      })

      async function* gen(): AsyncGenerator<Delta> {
        try {
          if (entry?.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs))
          const text = resolve(req)
          const size = entry?.chunkSize ?? text.length || 1
          for (let i = 0; i < text.length; i += size) {
            yield { text: text.slice(i, i + size) }
          }
          settle({ text, usage: { ...USAGE }, model: req.model })
        } catch (e) {
          fail(e)
          throw e
        }
      }

      const handle = gen() as unknown as StreamHandle
      Object.defineProperty(handle, 'done', { value: done })
      // Prevent an unhandled rejection when a caller never awaits done.
      void done.catch(() => {})
      return handle
    },
  }
}
```

- [ ] **Step 5: Write the OpenRouter provider**

`council/providers/openrouter.ts`:
```ts
import type { CompleteRequest, Completion, Delta, Provider, StreamHandle, Usage } from './types'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'Model Council',
  }
}

function body(req: CompleteRequest, stream: boolean): string {
  return JSON.stringify({
    model: req.model,
    stream,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  })
}

function parseUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, number>
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    costUsd: u.cost ?? 0,
  }
}

export function createOpenRouterProvider(apiKey: string): Provider {
  return {
    async complete(req: CompleteRequest): Promise<Completion> {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: headers(apiKey),
        body: body(req, false),
        signal: req.signal,
      })
      if (!res.ok) {
        throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
      }
      const data = (await res.json()) as {
        model?: string
        choices?: Array<{ message?: { content?: string } }>
        usage?: unknown
      }
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        usage: parseUsage(data.usage),
        model: data.model ?? req.model,
      }
    },

    stream(req: CompleteRequest): StreamHandle {
      let settle: (c: Completion) => void = () => {}
      let fail: (e: unknown) => void = () => {}
      const done = new Promise<Completion>((res, rej) => {
        settle = res
        fail = rej
      })

      async function* gen(): AsyncGenerator<Delta> {
        try {
          const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: headers(apiKey),
            body: body(req, true),
            signal: req.signal,
          })
          if (!res.ok || !res.body) {
            throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let text = ''
          let usage: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 }

          while (true) {
            const { done: finished, value } = await reader.read()
            if (finished) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue
              const payload = trimmed.slice(5).trim()
              if (payload === '[DONE]') continue
              let evt: {
                choices?: Array<{ delta?: { content?: string } }>
                usage?: unknown
              }
              try {
                evt = JSON.parse(payload)
              } catch {
                continue // OpenRouter emits periodic comment lines
              }
              const piece = evt.choices?.[0]?.delta?.content
              if (piece) {
                text += piece
                yield { text: piece }
              }
              if (evt.usage) usage = parseUsage(evt.usage)
            }
          }

          settle({ text, usage, model: req.model })
        } catch (e) {
          fail(e)
          throw e
        }
      }

      const handle = gen() as unknown as StreamHandle
      Object.defineProperty(handle, 'done', { value: done })
      void done.catch(() => {})
      return handle
    },
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/council/providers.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 7: Commit**

```bash
git add council/providers tests/council/providers.test.ts
git commit -m "feat: provider seam with deterministic fake and OpenRouter client"
```

---

### Task 5: Resilient call layer — timeout, retry, and JSON repair

**Files:**
- Create: `council/call.ts`
- Test: `tests/council/call.test.ts`

**Interfaces:**
- Consumes: `Provider`, `CompleteRequest`, `Completion`, `Usage`, `addUsage`, `ZERO_USAGE` from Task 4
- Produces:
  - `function callWithRetry(provider: Provider, req: CompleteRequest, timeoutMs: number): Promise<Completion>`
  - `function completeJson<T>(provider, req, schema, timeoutMs): Promise<{ value: T; usage: Usage }>`
  - `class SeatFailure extends Error { readonly reason: string }`

- [ ] **Step 1: Write the failing call-layer test**

`tests/council/call.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { callWithRetry, completeJson, SeatFailure } from '@/council/call'
import { makeFakeProvider } from '@/council/providers/fake'
import type { Provider } from '@/council/providers/types'

const Schema = z.object({ ok: z.boolean() })

function providerReturning(...texts: string[]): Provider & { calls: number } {
  let calls = 0
  const p = {
    get calls() { return calls },
    async complete() {
      const t = texts[Math.min(calls, texts.length - 1)]
      calls++
      return { text: t, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0.001 }, model: 'm' }
    },
    stream() { throw new Error('not used') },
  }
  return p as unknown as Provider & { calls: number }
}

describe('callWithRetry', () => {
  it('returns on first success without retrying', async () => {
    const p = makeFakeProvider({ m: { text: 'fine' } })
    const out = await callWithRetry(p, { model: 'm', system: 's', user: 'u' }, 1000)
    expect(out.text).toBe('fine')
    expect(p.requests).toHaveLength(1)
  })

  it('retries once on failure then succeeds', async () => {
    let calls = 0
    const p: Provider = {
      async complete() {
        calls++
        if (calls === 1) throw new Error('openrouter 503')
        return { text: 'second try', usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 }, model: 'm' }
      },
      stream() { throw new Error('not used') },
    }
    const out = await callWithRetry(p, { model: 'm', system: 's', user: 'u' }, 1000)
    expect(out.text).toBe('second try')
    expect(calls).toBe(2)
  })

  it('throws SeatFailure after the retry also fails', async () => {
    const p: Provider = {
      async complete() { throw new Error('openrouter 500') },
      stream() { throw new Error('not used') },
    }
    await expect(callWithRetry(p, { model: 'm', system: 's', user: 'u' }, 1000)).rejects.toBeInstanceOf(SeatFailure)
  })

  it('times out a hanging call', async () => {
    const p: Provider = {
      complete: () => new Promise(() => {}),
      stream() { throw new Error('not used') },
    }
    await expect(callWithRetry(p, { model: 'm', system: 's', user: 'u' }, 20)).rejects.toThrow(/timed out/i)
  })
})

describe('completeJson', () => {
  it('parses valid json on the first call', async () => {
    const p = providerReturning('{"ok":true}')
    const { value } = await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(value).toEqual({ ok: true })
    expect(p.calls).toBe(1)
  })

  it('strips markdown fences before parsing', async () => {
    const p = providerReturning('```json\n{"ok":true}\n```')
    const { value } = await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(value).toEqual({ ok: true })
  })

  it('issues exactly one repair round-trip on invalid json, then succeeds', async () => {
    const p = providerReturning('{"ok":"yes"}', '{"ok":true}')
    const { value } = await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(value).toEqual({ ok: true })
    expect(p.calls).toBe(2)
  })

  it('fails the seat after a second validation failure — never a third attempt', async () => {
    const p = providerReturning('{"ok":"no"}', '{"ok":"still no"}')
    await expect(
      completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000),
    ).rejects.toBeInstanceOf(SeatFailure)
    expect(p.calls).toBe(2)
  })

  it('echoes the validation error back to the model in the repair prompt', async () => {
    const seen: string[] = []
    let calls = 0
    const p: Provider = {
      async complete(req) {
        seen.push(req.user)
        calls++
        return {
          text: calls === 1 ? '{"ok":"yes"}' : '{"ok":true}',
          usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 },
          model: 'm',
        }
      },
      stream() { throw new Error('not used') },
    }
    await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(seen[1]).toMatch(/ok/)
    expect(seen[1]).toMatch(/previous response/i)
  })

  it('accumulates usage across the repair round-trip', async () => {
    const p = providerReturning('{"ok":"yes"}', '{"ok":true}')
    const { usage } = await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(usage.promptTokens).toBe(2)
    expect(usage.completionTokens).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/council/call.test.ts`
Expected: FAIL — cannot resolve `@/council/call`

- [ ] **Step 3: Write the implementation**

`council/call.ts`:
```ts
import type { ZodType } from 'zod'
import type { CompleteRequest, Completion, Provider, Usage } from './providers/types'
import { ZERO_USAGE, addUsage } from './providers/types'

export class SeatFailure extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'SeatFailure'
    this.reason = reason
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/** One timeout-guarded attempt, then one jittered retry. Spec section 10. */
export async function callWithRetry(
  provider: Provider,
  req: CompleteRequest,
  timeoutMs: number,
): Promise<Completion> {
  try {
    return await withTimeout(provider.complete(req), timeoutMs, req.model)
  } catch (first) {
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 500))
    try {
      return await withTimeout(provider.complete(req), timeoutMs, req.model)
    } catch (second) {
      throw new SeatFailure(
        `${req.model} failed twice: ${(first as Error).message} / ${(second as Error).message}`,
      )
    }
  }
}

/** Models often wrap JSON in markdown fences despite instructions. */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (fenced ? fenced[1] : text).trim()
}

/**
 * A structured call with exactly one repair round-trip. On the first
 * validation failure the error is echoed back to the model. A second
 * failure fails the seat — there is never a third attempt. Spec section 7.
 */
export async function completeJson<T>(
  provider: Provider,
  req: CompleteRequest,
  schema: ZodType<T>,
  timeoutMs: number,
): Promise<{ value: T; usage: Usage }> {
  let usage: Usage = ZERO_USAGE

  const first = await callWithRetry(provider, { ...req, json: true }, timeoutMs)
  usage = addUsage(usage, first.usage)

  const attempt = (raw: string) => {
    try {
      return { ok: true as const, value: schema.parse(JSON.parse(stripFences(raw))) }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  }

  const firstResult = attempt(first.text)
  if (firstResult.ok) return { value: firstResult.value, usage }

  const repairReq: CompleteRequest = {
    ...req,
    json: true,
    user: [
      req.user,
      '',
      '--- REPAIR ---',
      'Your previous response did not satisfy the required schema.',
      `Validation error: ${firstResult.error}`,
      'Return ONLY valid JSON matching the schema. No prose, no markdown fences.',
    ].join('\n'),
  }

  const second = await callWithRetry(provider, repairReq, timeoutMs)
  usage = addUsage(usage, second.usage)

  const secondResult = attempt(second.text)
  if (secondResult.ok) return { value: secondResult.value, usage }

  throw new SeatFailure(`${req.model} produced invalid JSON twice: ${secondResult.error}`)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/council/call.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add council/call.ts tests/council/call.test.ts
git commit -m "feat: retry, timeout, and single-repair JSON completion"
```

---

### Task 6: Event contract and the draft stage (R1)

**Files:**
- Create: `council/events.ts`, `council/stages/draft.ts`
- Test: `tests/council/draft.test.ts`

**Interfaces:**
- Consumes: `Seat`, `CouncilConfig` (Task 2); `Provider`, `Usage`, `ZERO_USAGE` (Task 4); `SeatFailure` (Task 5)
- Produces:
  - `type CouncilEvent` — the discriminated union in spec §9
  - `type Emit = (e: CouncilEvent) => void`
  - `type SeatStatus = 'ok' | 'failed'`
  - `type DraftResult = { seatId: number; model: string; label: string; text: string; usage: Usage; status: SeatStatus; error?: string }`
  - `function runDraftStage(query: string, config: CouncilConfig, provider: Provider, emit: Emit): Promise<DraftResult[]>`
  - `const DRAFT_SYSTEM: string`

- [ ] **Step 1: Write the failing draft-stage test**

`tests/council/draft.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runDraftStage, DRAFT_SYSTEM } from '@/council/stages/draft'
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
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/council/draft.test.ts`
Expected: FAIL — cannot resolve `@/council/events`

- [ ] **Step 3: Write the event contract**

`council/events.ts`:
```ts
import type { Usage } from './providers/types'
import type { CritiqueOutput, Verdict } from './schemas'
import type { CouncilConfig } from './config'

export type Stage = 'draft' | 'critique' | 'judge'

// The wire contract in spec section 9. Event order is part of the contract
// and is covered by tests.
export type CouncilEvent =
  | { type: 'run_started'; runId: string; config: CouncilConfig }
  | { type: 'stage_started'; stage: Stage }
  | { type: 'seat_started'; seat: number; model: string }
  | { type: 'token'; seat: number; text: string }
  | { type: 'seat_done'; seat: number; usage: Usage }
  | { type: 'seat_failed'; seat: number; reason: string }
  | { type: 'critique_done'; seat: number; payload: CritiqueOutput }
  | { type: 'stage_done'; stage: Stage }
  | { type: 'verdict'; payload: Verdict; confidenceAdjusted: boolean }
  | { type: 'run_done'; runId: string; usage: Usage }
  | { type: 'run_failed'; runId: string; reason: string }

export type Emit = (e: CouncilEvent) => void
```

- [ ] **Step 4: Write the draft stage**

`council/stages/draft.ts`:
```ts
import type { CouncilConfig, Seat } from '../config'
import type { Emit } from '../events'
import type { Provider, Usage } from '../providers/types'
import { ZERO_USAGE } from '../providers/types'

export type SeatStatus = 'ok' | 'failed'

export type DraftResult = {
  seatId: number
  model: string
  label: string
  text: string
  usage: Usage
  status: SeatStatus
  error?: string
}

// Spec 4.2: drafters must not self-identify, and must not be told that a
// council exists. Any shared context before drafting collapses diversity,
// which is the only thing a council has over a single model.
export const DRAFT_SYSTEM = [
  'You are answering a question as well as you possibly can.',
  '',
  'Rules:',
  '- Answer directly and completely. Lead with the answer, not with preamble.',
  '- Where you are uncertain, say so explicitly rather than hedging vaguely.',
  '- Do not name, identify, or allude to yourself, your model, or your creator.',
  '- Do not open with pleasantries or restate the question.',
  '- Use markdown. Keep it tight.',
].join('\n')

async function draftOne(
  seat: Seat,
  query: string,
  timeoutMs: number,
  provider: Provider,
  emit: Emit,
): Promise<DraftResult> {
  emit({ type: 'seat_started', seat: seat.id, model: seat.model })

  const base: DraftResult = {
    seatId: seat.id,
    model: seat.model,
    label: seat.label,
    text: '',
    usage: ZERO_USAGE,
    status: 'ok',
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const handle = provider.stream({
      model: seat.model,
      system: DRAFT_SYSTEM,
      user: query,
      signal: controller.signal,
    })

    let text = ''
    for await (const delta of handle) {
      text += delta.text
      emit({ type: 'token', seat: seat.id, text: delta.text })
    }

    const completion = await handle.done
    emit({ type: 'seat_done', seat: seat.id, usage: completion.usage })
    return { ...base, text: text || completion.text, usage: completion.usage }
  } catch (e) {
    const reason = (e as Error).message
    emit({ type: 'seat_failed', seat: seat.id, reason })
    return { ...base, status: 'failed', error: reason }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * R1. Three drafters answer in parallel, in isolation. A seat that fails is
 * marked failed and the protocol continues with the survivors (spec 10).
 * This is the only stage that streams tokens (spec 9).
 */
export async function runDraftStage(
  query: string,
  config: CouncilConfig,
  provider: Provider,
  emit: Emit,
): Promise<DraftResult[]> {
  emit({ type: 'stage_started', stage: 'draft' })
  const results = await Promise.all(
    config.drafters.map((seat) => draftOne(seat, query, config.timeoutMs, provider, emit)),
  )
  emit({ type: 'stage_done', stage: 'draft' })
  return results
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/council/draft.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add council/events.ts council/stages/draft.ts tests/council/draft.test.ts
git commit -m "feat: event contract and parallel streaming draft stage"
```

---

### Task 7: Critique stage (R2)

**Files:**
- Create: `council/stages/critique.ts`
- Test: `tests/council/critique.test.ts`

**Interfaces:**
- Consumes: `DraftResult`, `Emit` (Task 6); `anonymizePeers`, `makeRng` (Task 3); `completeJson`, `SeatFailure` (Task 5); `CritiqueOutputSchema`, `CritiqueOutput` (Task 2)
- Produces:
  - `type CritiqueResult = { seatId: number; model: string; payload: CritiqueOutput | null; peerMap: Partial<Record<'A' | 'B', number>>; usage: Usage; status: SeatStatus; error?: string }`
  - `function runCritiqueStage(query, drafts: DraftResult[], config, provider, emit, seed?): Promise<CritiqueResult[]>`
  - `const CRITIQUE_SYSTEM: string`

- [ ] **Step 1: Write the failing critique-stage test**

`tests/council/critique.test.ts`:
```ts
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
    expect(byModel.get('m1')).not.toContain('alpha draft')
    expect(byModel.get('m1')).toContain('beta draft')
    expect(byModel.get('m1')).toContain('gamma draft')
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/council/critique.test.ts`
Expected: FAIL — cannot resolve `@/council/stages/critique`

- [ ] **Step 3: Write the critique stage**

`council/stages/critique.ts`:
```ts
import type { CouncilConfig } from '../config'
import type { Emit } from '../events'
import type { Provider, Usage } from '../providers/types'
import { ZERO_USAGE } from '../providers/types'
import { anonymizePeers, makeRng, type Draft } from '../anonymize'
import { completeJson } from '../call'
import { CritiqueOutputSchema, type CritiqueOutput } from '../schemas'
import type { DraftResult, SeatStatus } from './draft'

export type CritiqueResult = {
  seatId: number
  model: string
  payload: CritiqueOutput | null
  peerMap: Partial<Record<'A' | 'B', number>>
  usage: Usage
  status: SeatStatus
  error?: string
}

export const CRITIQUE_SYSTEM = [
  'You are reviewing anonymous answers to a question, then improving your own.',
  '',
  'You will see the original question, your own answer, and one or two peer',
  'answers labelled Draft A and Draft B. You do not know who wrote them.',
  '',
  'For each peer draft you MUST report:',
  '- strengths: at least one thing it genuinely does better than yours',
  '- gaps: at least one gap. Something it omitted, under-specified, or ducked.',
  '- risks: at least one risk. An assumption, failure mode, or cost it ignores.',
  '- factual_errors: anything you believe is wrong. May be empty, but only if',
  '  you are confident there are none.',
  '',
  'Empty strengths, gaps, or risks arrays will be rejected. "It looks good" is',
  'not a review. Find the real weakness.',
  '',
  'Then rewrite your own answer, incorporating anything the peers got right',
  'that you missed. Do not merely append. Rewrite it as one coherent answer.',
  'Do not name, identify, or allude to yourself, your model, or your creator.',
  '',
  'Respond with ONLY a JSON object matching this shape:',
  '{"critiques":[{"target":"A","strengths":[""],"gaps":[""],"risks":[""],"factual_errors":[]}],"revised_answer":""}',
  'Include exactly one entry per peer draft shown to you — no more, no fewer.',
].join('\n')

function buildUserPrompt(query: string, own: string, peers: ReturnType<typeof anonymizePeers>): string {
  const blocks = peers.map((p) => `--- DRAFT ${p.label} ---\n${p.text}`).join('\n\n')
  return [
    `QUESTION:\n${query}`,
    '',
    `--- YOUR OWN ANSWER ---\n${own}`,
    '',
    blocks,
  ].join('\n')
}

/**
 * R2. Each surviving drafter critiques its peers blind, then revises its own
 * answer. The A/B assignment is shuffled independently per critic, so ordinal
 * position never correlates with seat identity (spec 4.2).
 */
export async function runCritiqueStage(
  query: string,
  drafts: DraftResult[],
  config: CouncilConfig,
  provider: Provider,
  emit: Emit,
  seed: number = Date.now(),
): Promise<CritiqueResult[]> {
  emit({ type: 'stage_started', stage: 'critique' })

  const survivors = drafts.filter((d) => d.status === 'ok')
  const asDrafts: Draft[] = survivors.map((d) => ({ seatId: d.seatId, text: d.text }))

  const results = await Promise.all(
    survivors.map(async (self): Promise<CritiqueResult> => {
      emit({ type: 'seat_started', seat: self.seatId, model: self.model })

      // A distinct RNG per critic — the shuffle must not be shared.
      const peers = anonymizePeers(asDrafts, self.seatId, makeRng(seed + self.seatId * 7919))
      const peerMap = Object.fromEntries(peers.map((p) => [p.label, p.seatId])) as Partial<
        Record<'A' | 'B', number>
      >

      const base: CritiqueResult = {
        seatId: self.seatId,
        model: self.model,
        payload: null,
        peerMap,
        usage: ZERO_USAGE,
        status: 'ok',
      }

      if (peers.length === 0) {
        // Sole survivor: nothing to critique. Keep the original as the revision.
        const solo: CritiqueOutput = { critiques: [], revised_answer: self.text } as CritiqueOutput
        return { ...base, payload: solo }
      }

      try {
        const { value, usage } = await completeJson(
          provider,
          {
            model: self.model,
            system: CRITIQUE_SYSTEM,
            user: buildUserPrompt(query, self.text, peers),
          },
          CritiqueOutputSchema,
          config.timeoutMs,
        )
        emit({ type: 'critique_done', seat: self.seatId, payload: value })
        emit({ type: 'seat_done', seat: self.seatId, usage })
        return { ...base, payload: value, usage }
      } catch (e) {
        const reason = (e as Error).message
        emit({ type: 'seat_failed', seat: self.seatId, reason })
        return { ...base, status: 'failed', error: reason }
      }
    }),
  )

  emit({ type: 'stage_done', stage: 'critique' })
  return results
}
```

Note: when a council is degraded to a single survivor the critique schema's
`.length(2)` cannot be satisfied, so the sole-survivor branch bypasses the model
call entirely rather than sending a request that is guaranteed to fail
validation twice.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/council/critique.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add council/stages/critique.ts tests/council/critique.test.ts
git commit -m "feat: blind cross-critique stage with self-revision"
```

---

### Task 8: Judge stage (R3) and confidence verification

**Files:**
- Create: `council/stages/judge.ts`
- Test: `tests/council/judge.test.ts`

**Interfaces:**
- Consumes: `DraftResult` (Task 6), `CritiqueResult` (Task 7), `completeJson` (Task 5), `VerdictSchema`, `Verdict`, `Confidence` (Task 2)
- Produces:
  - `type JudgeResult = { verdict: Verdict | null; usage: Usage; status: SeatStatus; error?: string; confidenceAdjusted: boolean }`
  - `function verifyConfidence(v: Verdict): { verdict: Verdict; adjusted: boolean }`
  - `function runJudgeStage(query, drafts, critiques, config, provider, emit): Promise<JudgeResult>`
  - `const JUDGE_SYSTEM: string`

- [ ] **Step 1: Write the failing judge test**

`tests/council/judge.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/council/judge.test.ts`
Expected: FAIL — cannot resolve `@/council/stages/judge`

- [ ] **Step 3: Write the judge stage**

`council/stages/judge.ts`:
```ts
import type { CouncilConfig } from '../config'
import type { Emit } from '../events'
import type { Provider, Usage } from '../providers/types'
import { ZERO_USAGE } from '../providers/types'
import { completeJson } from '../call'
import { VerdictSchema, type Verdict } from '../schemas'
import type { DraftResult, SeatStatus } from './draft'
import type { CritiqueResult } from './critique'

export type JudgeResult = {
  verdict: Verdict | null
  usage: Usage
  status: SeatStatus
  error?: string
  confidenceAdjusted: boolean
}

export const JUDGE_SYSTEM = [
  'You are the judge of a model council. Several members answered the same',
  'question independently, then critiqued each other blind and revised.',
  '',
  'Your job is to SYNTHESIZE, not to pick a winner. Take the strongest parts',
  'of every member and produce one answer better than any single member wrote.',
  '',
  'You must also report where the members disagreed. That disagreement is the',
  'most valuable thing the council produces, so do not smooth it over.',
  '',
  'Rules:',
  '- answer_markdown: the synthesized answer. Complete and standalone.',
  '- provenance: the key claims, each marked unanimous (all members), majority',
  '  (most), or single (one member only), with the seat numbers that support it.',
  '- contested: every point where members genuinely conflicted. Give each side,',
  '  your ruling, and why. An empty list is correct only if they truly agreed.',
  '- confidence: high only when most claims are unanimous or majority supported.',
  '',
  'Members are identified only as Seat 1, Seat 2, Seat 3. You do not know which',
  'model holds which seat. Judge the content.',
  '',
  'Respond with ONLY a JSON object of this shape:',
  '{"answer_markdown":"","provenance":[{"claim":"","support":"unanimous","seats":[1]}],',
  '"contested":[{"point":"","positions":[{"seat":1,"position":""}],"ruling":"","reasoning":""}],',
  '"confidence":"high"}',
].join('\n')

/**
 * Confidence is a property of the council, not an assertion by one model.
 * A verdict claiming `high` while more than a third of its claims rest on a
 * single seat is downgraded, and the adjustment is recorded (spec 7.2).
 */
export function verifyConfidence(v: Verdict): { verdict: Verdict; adjusted: boolean } {
  if (v.confidence !== 'high' || v.provenance.length === 0) {
    return { verdict: v, adjusted: false }
  }
  const single = v.provenance.filter((p) => p.support === 'single').length
  if (single / v.provenance.length > 1 / 3) {
    return { verdict: { ...v, confidence: 'medium' }, adjusted: true }
  }
  return { verdict: v, adjusted: false }
}

function buildUserPrompt(
  query: string,
  drafts: DraftResult[],
  critiques: CritiqueResult[],
): string {
  const parts: string[] = [`QUESTION:\n${query}`, '']

  for (const d of drafts.filter((x) => x.status === 'ok')) {
    parts.push(`--- SEAT ${d.seatId} ORIGINAL DRAFT ---\n${d.text}`, '')
  }

  for (const c of critiques.filter((x) => x.status === 'ok' && x.payload)) {
    const lines = c.payload!.critiques.map((peer) => {
      const target = c.peerMap[peer.target]
      return [
        `On Seat ${target ?? '?'}:`,
        `  strengths: ${peer.strengths.join('; ')}`,
        `  gaps: ${peer.gaps.join('; ')}`,
        `  risks: ${peer.risks.join('; ')}`,
        `  factual errors: ${peer.factual_errors.join('; ') || 'none reported'}`,
      ].join('\n')
    })
    parts.push(`--- SEAT ${c.seatId} CRITIQUES ---\n${lines.join('\n')}`, '')
    parts.push(`--- SEAT ${c.seatId} REVISED ANSWER ---\n${c.payload!.revised_answer}`, '')
  }

  return parts.join('\n')
}

/**
 * R3. The judge wrote no draft, so it has no answer of its own to favour.
 * If it fails there is no fallback — promoting a drafter would reintroduce
 * exactly the self-preference bias the roster exists to prevent (spec 10).
 */
export async function runJudgeStage(
  query: string,
  drafts: DraftResult[],
  critiques: CritiqueResult[],
  config: CouncilConfig,
  provider: Provider,
  emit: Emit,
): Promise<JudgeResult> {
  emit({ type: 'stage_started', stage: 'judge' })
  emit({ type: 'seat_started', seat: config.judge.id, model: config.judge.model })

  try {
    const { value, usage } = await completeJson(
      provider,
      {
        model: config.judge.model,
        system: JUDGE_SYSTEM,
        user: buildUserPrompt(query, drafts, critiques),
      },
      VerdictSchema,
      config.timeoutMs,
    )
    const { verdict, adjusted } = verifyConfidence(value)
    emit({ type: 'seat_done', seat: config.judge.id, usage })
    emit({ type: 'verdict', payload: verdict, confidenceAdjusted: adjusted })
    emit({ type: 'stage_done', stage: 'judge' })
    return { verdict, usage, status: 'ok', confidenceAdjusted: adjusted }
  } catch (e) {
    const reason = (e as Error).message
    emit({ type: 'seat_failed', seat: config.judge.id, reason })
    emit({ type: 'stage_done', stage: 'judge' })
    return { verdict: null, usage: ZERO_USAGE, status: 'failed', error: reason, confidenceAdjusted: false }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/council/judge.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add council/stages/judge.ts tests/council/judge.test.ts
git commit -m "feat: impartial judge stage with council-verified confidence"
```

---

### Task 9: Orchestrator — sequencing, quorum, and usage accounting

**Files:**
- Create: `council/orchestrator.ts`
- Test: `tests/council/orchestrator.test.ts`

**Interfaces:**
- Consumes: every stage from Tasks 6–8, `addUsage`/`ZERO_USAGE` (Task 4), `QUORUM_MIN_DRAFTERS` (Task 2)
- Produces:
  - `type RunStatus = 'complete' | 'degraded' | 'failed'`
  - `type RunRecord = { id: string; query: string; config: CouncilConfig; status: RunStatus; stages: { drafts: DraftResult[]; critiques: CritiqueResult[] }; verdict: Verdict | null; confidenceAdjusted: boolean; usage: Usage; error?: string; elapsedMs: number }`
  - `function runCouncil(query: string, config: CouncilConfig, provider: Provider, emit: Emit, opts?: { runId?: string; seed?: number }): Promise<RunRecord>`

- [ ] **Step 1: Write the failing orchestrator test**

`tests/council/orchestrator.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/council/orchestrator.test.ts`
Expected: FAIL — cannot resolve `@/council/orchestrator`

- [ ] **Step 3: Write the orchestrator**

`council/orchestrator.ts`:
```ts
import { QUORUM_MIN_DRAFTERS, type CouncilConfig } from './config'
import type { Emit } from './events'
import type { Provider, Usage } from './providers/types'
import { ZERO_USAGE, addUsage } from './providers/types'
import type { Verdict } from './schemas'
import { runDraftStage, type DraftResult } from './stages/draft'
import { runCritiqueStage, type CritiqueResult } from './stages/critique'
import { runJudgeStage } from './stages/judge'

export type RunStatus = 'complete' | 'degraded' | 'failed'

export type RunRecord = {
  id: string
  query: string
  config: CouncilConfig
  status: RunStatus
  stages: { drafts: DraftResult[]; critiques: CritiqueResult[] }
  verdict: Verdict | null
  confidenceAdjusted: boolean
  usage: Usage
  error?: string
  elapsedMs: number
}

export type RunOptions = { runId?: string; seed?: number }

/**
 * The protocol driver. Depends only on the Provider interface — never on
 * fetch, env, or OpenRouter — so the whole council is testable with
 * deterministic fakes and reusable as a CLI or MCP server (spec 6.1).
 */
export async function runCouncil(
  query: string,
  config: CouncilConfig,
  provider: Provider,
  emit: Emit,
  opts: RunOptions = {},
): Promise<RunRecord> {
  const id = opts.runId ?? crypto.randomUUID()
  const seed = opts.seed ?? Date.now()
  const started = Date.now()

  emit({ type: 'run_started', runId: id, config })

  const base = {
    id,
    query,
    config,
    stages: { drafts: [] as DraftResult[], critiques: [] as CritiqueResult[] },
    verdict: null as Verdict | null,
    confidenceAdjusted: false,
    usage: ZERO_USAGE,
  }

  // R1
  const drafts = await runDraftStage(query, config, provider, emit)
  let usage = drafts.reduce((acc, d) => addUsage(acc, d.usage), ZERO_USAGE)
  const survivors = drafts.filter((d) => d.status === 'ok')

  // Quorum is checked before R2, so a doomed run never pays for a critique
  // round or a judge call (spec 10).
  if (survivors.length < QUORUM_MIN_DRAFTERS) {
    const reason = `quorum not met: ${survivors.length} of ${config.drafters.length} drafters survived, ${QUORUM_MIN_DRAFTERS} required`
    emit({ type: 'run_failed', runId: id, reason })
    return { ...base, stages: { drafts, critiques: [] }, status: 'failed', usage, error: reason, elapsedMs: Date.now() - started }
  }

  // R2
  const critiques = await runCritiqueStage(query, drafts, config, provider, emit, seed)
  usage = critiques.reduce((acc, c) => addUsage(acc, c.usage), usage)

  // R3
  const judged = await runJudgeStage(query, drafts, critiques, config, provider, emit)
  usage = addUsage(usage, judged.usage)

  const stages = { drafts, critiques }

  if (judged.status === 'failed') {
    const reason = `judge failed: ${judged.error}`
    emit({ type: 'run_failed', runId: id, reason })
    return { ...base, stages, status: 'failed', usage, error: reason, elapsedMs: Date.now() - started }
  }

  const degraded =
    survivors.length < config.drafters.length || critiques.some((c) => c.status === 'failed')

  emit({ type: 'run_done', runId: id, usage })

  return {
    ...base,
    stages,
    status: degraded ? 'degraded' : 'complete',
    verdict: judged.verdict,
    confidenceAdjusted: judged.confidenceAdjusted,
    usage,
    elapsedMs: Date.now() - started,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/council/orchestrator.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — all suites green. The council engine is now complete and fully tested without a single network call.

- [ ] **Step 6: Commit**

```bash
git add council/orchestrator.ts tests/council/orchestrator.test.ts
git commit -m "feat: council orchestrator with quorum enforcement and usage accounting"
```

---

### Task 10: Persistence

**Files:**
- Create: `prisma/schema.prisma`, `lib/db.ts`
- Test: `tests/lib/db.test.ts`

**Interfaces:**
- Consumes: `RunRecord` (Task 9)
- Produces:
  - `const prisma: PrismaClient`
  - `function saveRun(run: RunRecord): Promise<string>`
  - `function loadRun(id: string): Promise<RunRecord | null>`
  - `function serializeRun(run: RunRecord): RunRow` — `RunRow` is declared in `lib/db.ts`
  - `function deserializeRun(row: Run): RunRecord`

- [ ] **Step 1: Write the Prisma schema**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// One table. Stage payloads are JSON blobs rather than normalized rows
// because the protocol is still moving — spec section 8.
model Run {
  id        String   @id
  query     String
  config    String
  status    String
  stages    String
  verdict   String?
  usage     String
  error     String?
  elapsedMs Int      @default(0)
  createdAt DateTime @default(now())
}
```

SQLite has no native JSON column, so blobs are stored as `String` and
(de)serialized in `lib/db.ts`. The Postgres migration swaps `provider` to
`postgresql` and these fields to `Json`; the serialize/deserialize seam is
the single place that changes.

- [ ] **Step 2: Generate the client and create the dev database**

```bash
echo 'DATABASE_URL="file:./dev.db"' > .env
npx prisma migrate dev --name init
```

Expected: `prisma/migrations/` created, `dev.db` written, client generated.

- [ ] **Step 3: Write the failing serialization test**

Serialization is the only logic worth testing here — round-tripping a run
through the JSON-blob encoding must be lossless.

`tests/lib/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { serializeRun, deserializeRun } from '@/lib/db'
import type { RunRecord } from '@/council/orchestrator'
import { DEFAULT_CONFIG } from '@/council/config'

const run: RunRecord = {
  id: 'abc123',
  query: 'What is the best database?',
  config: DEFAULT_CONFIG,
  status: 'degraded',
  stages: {
    drafts: [
      { seatId: 1, model: 'm1', label: 'Seat 1', text: 'draft', usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.001 }, status: 'ok' },
      { seatId: 2, model: 'm2', label: 'Seat 2', text: '', usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 }, status: 'failed', error: 'boom' },
    ],
    critiques: [],
  },
  verdict: {
    answer_markdown: '# Final',
    provenance: [{ claim: 'c', support: 'unanimous', seats: [1, 3] }],
    contested: [{ point: 'p', positions: [{ seat: 1, position: 'yes' }, { seat: 3, position: 'no' }], ruling: 'yes', reasoning: 'because' }],
    confidence: 'medium',
  },
  confidenceAdjusted: true,
  usage: { promptTokens: 700, completionTokens: 350, costUsd: 0.08 },
  elapsedMs: 41_000,
}

describe('run serialization', () => {
  it('round-trips losslessly', () => {
    expect(deserializeRun(serializeRun(run) as never)).toEqual(run)
  })

  it('preserves a null verdict on a failed run', () => {
    const failed: RunRecord = { ...run, status: 'failed', verdict: null, error: 'quorum not met' }
    const out = deserializeRun(serializeRun(failed) as never)
    expect(out.verdict).toBeNull()
    expect(out.error).toBe('quorum not met')
  })

  it('preserves the contested section, which is the point of the product', () => {
    const out = deserializeRun(serializeRun(run) as never)
    expect(out.verdict!.contested[0].ruling).toBe('yes')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/lib/db.test.ts`
Expected: FAIL — cannot resolve `@/lib/db`

- [ ] **Step 5: Write the db layer**

`lib/db.ts`:
```ts
import { PrismaClient } from '@prisma/client'
import type { RunRecord } from '@/council/orchestrator'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

type RunRow = {
  id: string
  query: string
  config: string
  status: string
  stages: string
  verdict: string | null
  usage: string
  error: string | null
  elapsedMs: number
}

/**
 * The single seam between the domain model and storage. Moving to Postgres
 * means changing the datasource and dropping the JSON.stringify calls here.
 */
export function serializeRun(run: RunRecord): RunRow {
  return {
    id: run.id,
    query: run.query,
    config: JSON.stringify(run.config),
    status: run.status,
    stages: JSON.stringify({ ...run.stages, confidenceAdjusted: run.confidenceAdjusted }),
    verdict: run.verdict ? JSON.stringify(run.verdict) : null,
    usage: JSON.stringify(run.usage),
    error: run.error ?? null,
    elapsedMs: run.elapsedMs,
  }
}

export function deserializeRun(row: RunRow): RunRecord {
  const stages = JSON.parse(row.stages) as RunRecord['stages'] & { confidenceAdjusted: boolean }
  const { confidenceAdjusted, ...rest } = stages
  const record: RunRecord = {
    id: row.id,
    query: row.query,
    config: JSON.parse(row.config),
    status: row.status as RunRecord['status'],
    stages: { drafts: rest.drafts, critiques: rest.critiques },
    verdict: row.verdict ? JSON.parse(row.verdict) : null,
    confidenceAdjusted,
    usage: JSON.parse(row.usage),
    elapsedMs: row.elapsedMs,
  }
  if (row.error !== null) record.error = row.error
  return record
}

export async function saveRun(run: RunRecord): Promise<string> {
  const data = serializeRun(run)
  await prisma.run.upsert({ where: { id: run.id }, create: data, update: data })
  return run.id
}

export async function loadRun(id: string): Promise<RunRecord | null> {
  const row = await prisma.run.findUnique({ where: { id } })
  return row ? deserializeRun(row as RunRow) : null
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/db.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 7: Commit**

```bash
git add prisma lib/db.ts tests/lib/db.test.ts .env.example
git commit -m "feat: single-table run persistence with lossless JSON blob round-trip"
```

---

### Task 11: SSE route and models catalog route

**Files:**
- Create: `app/api/council/route.ts`, `app/api/models/route.ts`, `lib/sse.ts`
- Test: `tests/lib/sse.test.ts`

**Interfaces:**
- Consumes: `runCouncil` (Task 9), `saveRun` (Task 10), `createOpenRouterProvider` (Task 4), `DEFAULT_CONFIG` (Task 2), `CouncilEvent` (Task 6)
- Produces:
  - `function encodeEvent(e: CouncilEvent): string`
  - `function parseEventStream(chunk: string): CouncilEvent[]`
  - `POST /api/council` — SSE stream
  - `GET /api/models` — cached catalog

- [ ] **Step 1: Write the failing SSE encoding test**

`tests/lib/sse.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { encodeEvent, parseEventStream } from '@/lib/sse'
import type { CouncilEvent } from '@/council/events'

describe('sse encoding', () => {
  it('encodes an event as a data line terminated by a blank line', () => {
    const e: CouncilEvent = { type: 'token', seat: 1, text: 'hi' }
    expect(encodeEvent(e)).toBe(`data: ${JSON.stringify(e)}\n\n`)
  })

  it('escapes newlines in token text so the frame is not split', () => {
    const e: CouncilEvent = { type: 'token', seat: 1, text: 'line one\nline two' }
    const encoded = encodeEvent(e)
    expect(encoded.split('\n\n')).toHaveLength(2)
    expect(parseEventStream(encoded)[0]).toEqual(e)
  })

  it('round-trips a batch of events in order', () => {
    const events: CouncilEvent[] = [
      { type: 'stage_started', stage: 'draft' },
      { type: 'token', seat: 1, text: 'a' },
      { type: 'stage_done', stage: 'draft' },
    ]
    const stream = events.map(encodeEvent).join('')
    expect(parseEventStream(stream)).toEqual(events)
  })

  it('ignores a trailing partial frame', () => {
    const stream = `${encodeEvent({ type: 'stage_done', stage: 'judge' })}data: {"type":"toke`
    expect(parseEventStream(stream)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/sse.test.ts`
Expected: FAIL — cannot resolve `@/lib/sse`

- [ ] **Step 3: Write the SSE codec**

`lib/sse.ts`:
```ts
import type { CouncilEvent } from '@/council/events'

// JSON.stringify already escapes newlines, so a single-line data frame is
// always safe. The blank line terminates the frame.
export function encodeEvent(e: CouncilEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`
}

export function parseEventStream(chunk: string): CouncilEvent[] {
  const out: CouncilEvent[] = []
  for (const frame of chunk.split('\n\n')) {
    const line = frame.trim()
    if (!line.startsWith('data:')) continue
    try {
      out.push(JSON.parse(line.slice(5).trim()) as CouncilEvent)
    } catch {
      // Trailing partial frame — the next chunk completes it.
    }
  }
  return out
}
```

- [ ] **Step 4: Write the council route**

`app/api/council/route.ts`:
```ts
import { NextRequest } from 'next/server'
import { runCouncil } from '@/council/orchestrator'
import { DEFAULT_CONFIG, type CouncilConfig } from '@/council/config'
import { createOpenRouterProvider } from '@/council/providers/openrouter'
import { encodeEvent } from '@/lib/sse'
import { saveRun } from '@/lib/db'
import type { CouncilEvent } from '@/council/events'

// Run durations exceed Edge limits — spec section 14.
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not set' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const body = (await req.json()) as { query?: string; config?: CouncilConfig }
  const query = body.query?.trim()
  if (!query) {
    return new Response(JSON.stringify({ error: 'query is required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const config = body.config ?? DEFAULT_CONFIG
  const provider = createOpenRouterProvider(apiKey)
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: CouncilEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeEvent(e)))
        } catch {
          // Client disconnected mid-run. The council keeps going and the
          // finished run is still persisted, so the share link works.
        }
      }

      try {
        const run = await runCouncil(query, config, provider, emit)
        await saveRun(run)
      } catch (e) {
        emit({ type: 'run_failed', runId: 'unknown', reason: (e as Error).message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
```

- [ ] **Step 5: Write the models catalog route**

`app/api/models/route.ts`:
```ts
export const runtime = 'nodejs'
export const revalidate = 3600

type CatalogModel = { id: string; name: string; context_length: number; pricing: { prompt: string } }

export async function GET() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    next: { revalidate: 3600 },
  })
  if (!res.ok) {
    return Response.json({ error: `catalog unavailable (${res.status})` }, { status: 502 })
  }

  const data = (await res.json()) as { data: CatalogModel[] }

  // Trim the payload — the roster picker needs four fields, not the full
  // catalog, which is several hundred KB.
  const models = data.data
    .map((m) => ({
      id: m.id,
      name: m.name,
      context: m.context_length,
      inputPerM: Number(m.pricing?.prompt ?? 0) * 1e6,
      lab: m.id.split('/')[0],
    }))
    .filter((m) => !m.id.endsWith(':batch'))
    .sort((a, b) => a.id.localeCompare(b.id))

  return Response.json({ models })
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/sse.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 7: Commit**

```bash
git add app/api lib/sse.ts tests/lib/sse.test.ts
git commit -m "feat: SSE council route and cached model catalog proxy"
```

---

### Task 12: Terminal UI primitives

**Files:**
- Create: `components/terminal/TerminalWindow.tsx`, `components/terminal/CommandLine.tsx`, `components/terminal/Panel.tsx`, `components/terminal/BarMeter.tsx`, `components/terminal/Caret.tsx`, `components/terminal/StatusDot.tsx`
- Create: `components/terminal/terminal.module.css`

**Interfaces:**
- Consumes: theme tokens (Task 1)
- Produces:
  - `<TerminalWindow path statusLabel statusTone children>` — the frame around the whole app
  - `<CommandLine command>` — a `$` prefixed section header
  - `<Panel title children>` — near-black hairlined panel
  - `<BarMeter label value max unit>` — the ASCII proficiency meter
  - `<Caret />` — blinking block cursor
  - `<StatusDot tone />` where `tone: 'live' | 'ok' | 'failed'`

- [ ] **Step 1: Write the shared stylesheet**

`components/terminal/terminal.module.css`:
```css
.window {
  max-width: 1120px;
  margin: 32px auto;
  background: var(--panel);
  border: 1px solid var(--hairline);
  border-radius: 8px;
  box-shadow: 0 0 60px rgba(57, 255, 122, 0.06);
  overflow: hidden;
}

.titlebar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: var(--panel-lift);
  border-bottom: 1px solid var(--hairline);
  font-size: 12px;
}

.dots { display: flex; gap: 7px; }
.dot { width: 11px; height: 11px; border-radius: 6px; }

.path { color: var(--sage); }
.pathUser { color: var(--phosphor); }

.nav { margin-left: auto; display: flex; gap: 18px; align-items: center; }
.navLink { color: var(--sage); text-decoration: none; }
.navLink:hover { color: var(--phosphor); text-shadow: var(--glow-soft); }

.status { display: flex; align-items: center; gap: 7px; color: var(--amber); font-size: 12px; }
.statusDot { width: 7px; height: 7px; border-radius: 4px; animation: blink 1.6s step-end infinite; }

.body { padding: 28px 32px 40px; }

.command { margin: 40px 0 18px; font-size: 13px; }
.command:first-child { margin-top: 0; }
.prompt { color: var(--phosphor-dim); }
.cmd { color: var(--ink); }

.panel {
  background: var(--panel);
  border: 1px solid var(--hairline);
  border-radius: 6px;
  padding: 20px;
}
.panelTitle { color: var(--phosphor); text-shadow: var(--glow-soft); margin-bottom: 14px; font-size: 13px; }

.meterRow { display: grid; grid-template-columns: 150px 1fr 48px; gap: 12px; align-items: center; margin: 7px 0; }
.meterLabel { color: var(--sage); font-size: 12px; }
.meterTrack {
  height: 9px;
  background: #000;
  border: 1px solid var(--hairline);
  border-radius: 3px;
  overflow: hidden;
}
.meterFill {
  height: 100%;
  background: linear-gradient(90deg, var(--phosphor-dim), var(--phosphor));
  box-shadow: var(--glow-soft);
}
.meterValue { color: var(--phosphor); font-size: 12px; text-align: right; }

.rule { height: 1px; background: linear-gradient(90deg, var(--hairline-bright), transparent); margin: 36px 0; border: 0; }
```

- [ ] **Step 2: Write the components**

`components/terminal/Caret.tsx`:
```tsx
export function Caret() {
  return <span className="caret" aria-hidden="true" />
}
```

`components/terminal/StatusDot.tsx`:
```tsx
import styles from './terminal.module.css'

const TONES = {
  live: 'var(--amber)',
  ok: 'var(--phosphor)',
  failed: 'var(--danger)',
} as const

export function StatusDot({ tone }: { tone: keyof typeof TONES }) {
  return <span className={styles.statusDot} style={{ background: TONES[tone] }} aria-hidden="true" />
}
```

`components/terminal/TerminalWindow.tsx`:
```tsx
import styles from './terminal.module.css'
import { StatusDot } from './StatusDot'

export function TerminalWindow({
  path = '~/session',
  statusLabel = 'idle',
  statusTone = 'ok',
  children,
}: {
  path?: string
  statusLabel?: string
  statusTone?: 'live' | 'ok' | 'failed'
  children: React.ReactNode
}) {
  return (
    <div className={styles.window}>
      <div className={styles.titlebar}>
        <div className={styles.dots}>
          <span className={styles.dot} style={{ background: 'var(--dot-red)' }} />
          <span className={styles.dot} style={{ background: 'var(--dot-amber)' }} />
          <span className={styles.dot} style={{ background: 'var(--dot-green)' }} />
        </div>
        <span className={styles.path}>
          <span className={styles.pathUser}>council</span>@openrouter: {path}
        </span>
        <nav className={styles.nav}>
          <a className={styles.navLink} href="/">~/ask</a>
          <a className={styles.navLink} href="/#roster">~/roster</a>
          <span className={styles.status}>
            <StatusDot tone={statusTone} />
            {statusLabel}
          </span>
        </nav>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  )
}
```

`components/terminal/CommandLine.tsx`:
```tsx
import styles from './terminal.module.css'

export function CommandLine({ command }: { command: string }) {
  return (
    <div className={styles.command}>
      <span className={styles.prompt}>council~/session $ </span>
      <span className={styles.cmd}>{command}</span>
    </div>
  )
}

export function Rule() {
  return <hr className={styles.rule} />
}
```

`components/terminal/Panel.tsx`:
```tsx
import styles from './terminal.module.css'

export function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className={styles.panel}>
      {title ? <div className={styles.panelTitle}>{title}</div> : null}
      {children}
    </section>
  )
}
```

`components/terminal/BarMeter.tsx`:
```tsx
import styles from './terminal.module.css'

export function BarMeter({
  label,
  value,
  max = 100,
  display,
}: {
  label: string
  value: number
  max?: number
  display?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={styles.meterRow}>
      <span className={styles.meterLabel}>{label}</span>
      <span className={styles.meterTrack}>
        <span className={styles.meterFill} style={{ width: `${pct}%` }} />
      </span>
      <span className={styles.meterValue}>{display ?? Math.round(pct)}</span>
    </div>
  )
}
```

- [ ] **Step 3: Verify the app still builds and renders**

Run: `npm run dev` and open `http://localhost:3000`
Expected: a black page under a visible scanline overlay, no console errors. (`app/page.tsx` is still the default; Task 13 replaces it.)

- [ ] **Step 4: Commit**

```bash
git add components/terminal
git commit -m "feat: terminal UI primitives — window frame, command line, panel, meter, caret"
```

---

### Task 13: Screen 1 — query input and roster

**Files:**
- Create: `app/page.tsx`, `components/screens/QueryScreen.tsx`, `components/roster/RosterPanel.tsx`, `components/roster/SeatCard.tsx`, `components/roster/roster.module.css`
- Modify: `app/globals.css` — add the `.nameBanner` class

**Interfaces:**
- Consumes: `TerminalWindow`, `CommandLine`, `Panel`, `Caret` (Task 12); `DEFAULT_CONFIG`, `CouncilConfig`, `Seat` (Task 2)
- Produces:
  - `<QueryScreen onSubmit={(query, config) => void} />`
  - `<RosterPanel config onChange />`
  - `<SeatCard seat role />` where `role: 'drafter' | 'judge'`

- [ ] **Step 1: Add the name banner class**

Preview hosts override a bare `h1`, so the banner is scoped to a class with an explicit `!important` — spec §11.1.

Append to `app/globals.css`:
```css
.nameBanner {
  font-size: 60px !important;
  font-weight: 800;
  line-height: 1.05;
  color: var(--ink);
  text-shadow: var(--glow);
  letter-spacing: -0.02em;
  margin: 0 0 14px;
}

.roleLine { color: var(--phosphor); font-size: 17px; text-shadow: var(--glow-soft); margin: 0 0 16px; }
.roleLine::before { content: '> '; color: var(--sage); }

.intro { color: var(--sage); max-width: 640px; margin: 0 0 20px; }
.hl { color: var(--phosphor); }

.metaChecks { display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 26px; font-size: 12px; color: var(--sage); }
.metaChecks span::before { content: '[x] '; color: var(--phosphor); }

@media (max-width: 900px) {
  .nameBanner { font-size: 38px !important; }
}
```

- [ ] **Step 2: Write the roster styles**

`components/roster/roster.module.css`:
```css
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }

.card {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 16px;
  background: var(--panel);
  border: 1px solid var(--hairline);
  border-radius: 6px;
  padding: 16px;
}
.card:hover { border-color: var(--hairline-bright); }
.judge { border-color: var(--hairline-bright); }

.avatar {
  color: var(--phosphor);
  text-shadow: var(--glow-soft);
  font-size: 9px;
  line-height: 1.1;
  margin: 0;
  white-space: pre;
}
.avatarLabel { color: var(--phosphor-faint); font-size: 10px; margin-top: 6px; }

.kvTitle { color: var(--ink); font-size: 12px; margin-bottom: 8px; }
.kv { display: grid; grid-template-columns: 76px 1fr; gap: 2px 10px; font-size: 12px; }
.k { color: var(--phosphor); }
.v { color: var(--sage); overflow-wrap: anywhere; }
.available { color: var(--amber); text-shadow: var(--glow-amber); }

.swatches { display: flex; gap: 3px; margin-top: 12px; }
.swatch { width: 14px; height: 7px; border-radius: 3px; }

.warning { color: var(--amber); font-size: 12px; margin-top: 12px; }
.warning::before { content: '[!] '; }
```

- [ ] **Step 3: Write the seat card**

`components/roster/SeatCard.tsx`:
```tsx
import type { Seat } from '@/council/config'
import styles from './roster.module.css'

const AVATAR = ['  ▄▄▄▄▄  ', ' █ ▀ ▀ █ ', ' █  ▄  █ ', ' ▀█▄▄▄█▀ ', '  ▐███▌  '].join('\n')

const SWATCHES = ['#1c7a3c', '#2bbf5c', '#39ff7a', '#5f8d68', '#eafff1', '#ffd24a', '#ff5f56', '#070b07']

export function SeatCard({ seat, role }: { seat: Seat; role: 'drafter' | 'judge' }) {
  return (
    <article className={`${styles.card} ${role === 'judge' ? styles.judge : ''}`}>
      <div>
        <pre className={styles.avatar}>{AVATAR}</pre>
        <div className={styles.avatarLabel}>{role === 'judge' ? 'judge@bench' : `seat${seat.id}@dev`}</div>
      </div>
      <div>
        <div className={styles.kvTitle}>
          {seat.label.toLowerCase().replace(' ', '')}@council {'-'.repeat(10)}
        </div>
        <dl className={styles.kv}>
          <dt className={styles.k}>Model</dt>
          <dd className={styles.v}>{seat.model.split('/')[1]}</dd>
          <dt className={styles.k}>Lab</dt>
          <dd className={styles.v}>{seat.lab}</dd>
          <dt className={styles.k}>Role</dt>
          <dd className={styles.v}>{role === 'judge' ? 'Synthesis, no draft' : 'Draft, critique, revise'}</dd>
          <dt className={styles.k}>Status</dt>
          <dd className={styles.available}>available</dd>
        </dl>
        <div className={styles.swatches}>
          {SWATCHES.map((c) => (
            <span key={c} className={styles.swatch} style={{ background: c }} />
          ))}
        </div>
      </div>
    </article>
  )
}
```

- [ ] **Step 4: Write the roster panel**

`components/roster/RosterPanel.tsx`:
```tsx
'use client'

import type { CouncilConfig } from '@/council/config'
import { Panel } from '@/components/terminal/Panel'
import { SeatCard } from './SeatCard'
import styles from './roster.module.css'

export function RosterPanel({ config }: { config: CouncilConfig }) {
  const labs = [...config.drafters.map((s) => s.lab), config.judge.lab]
  const judgeShares = labs.filter((l) => l === config.judge.lab).length > 1

  return (
    <Panel>
      <div className={styles.grid}>
        {config.drafters.map((seat) => (
          <SeatCard key={seat.id} seat={seat} role="drafter" />
        ))}
        <SeatCard seat={config.judge} role="judge" />
      </div>
      {judgeShares ? (
        <p className={styles.warning}>
          The judge shares a lab with a drafter. Blind labels reduce self-preference bias but do not
          eliminate it.
        </p>
      ) : null}
    </Panel>
  )
}
```

- [ ] **Step 5: Write the query screen**

`components/screens/QueryScreen.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { CommandLine, Rule } from '@/components/terminal/CommandLine'
import { Caret } from '@/components/terminal/Caret'
import { RosterPanel } from '@/components/roster/RosterPanel'
import { DEFAULT_CONFIG } from '@/council/config'

export function QueryScreen({ onSubmit }: { onSubmit: (query: string) => void }) {
  const [query, setQuery] = useState('')

  return (
    <>
      <CommandLine command="council --version" />

      <h1 className="nameBanner">
        MODEL COUNCIL<span style={{ color: 'var(--phosphor)' }}>_</span>
      </h1>
      <p className="roleLine">four models. one verdict.</p>
      <p className="intro">
        One question, answered independently by three models from three labs, then{' '}
        <span className="hl">critiqued blind</span> by each other and revised. A fourth model that
        wrote no draft synthesizes the result and reports{' '}
        <span className="hl">where they disagreed</span>.
      </p>

      <div className="metaChecks">
        <span>4 seats, 4 labs</span>
        <span>~$0.08 per run</span>
        <span>~40s end to end</span>
      </div>

      <CommandLine command="council ask" />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) onSubmit(query.trim())
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            background: '#000',
            border: '1px solid var(--hairline-bright)',
            borderRadius: 6,
            padding: '14px 16px',
            boxShadow: '0 0 20px rgba(57,255,122,0.07)',
          }}
        >
          <span style={{ color: 'var(--phosphor)', textShadow: 'var(--glow-soft)' }}>$</span>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
            }}
            rows={3}
            placeholder="ask the council something hard"
            style={{
              flex: 1,
              background: 'transparent',
              border: 0,
              outline: 'none',
              resize: 'vertical',
              color: 'var(--ink)',
              font: 'inherit',
            }}
          />
          {query ? null : <Caret />}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button
            type="submit"
            disabled={!query.trim()}
            style={{
              background: 'var(--phosphor)',
              color: '#00140a',
              border: 0,
              borderRadius: 6,
              padding: '10px 18px',
              font: 'inherit',
              fontWeight: 700,
              cursor: query.trim() ? 'pointer' : 'not-allowed',
              opacity: query.trim() ? 1 : 0.4,
              boxShadow: '0 0 18px rgba(57,255,122,0.35)',
            }}
          >
            $ council convene {'->'}
          </button>
          <span style={{ color: 'var(--phosphor-faint)', alignSelf: 'center', fontSize: 12 }}>
            cmd+enter
          </span>
        </div>
      </form>

      <Rule />
      <div id="roster">
        <CommandLine command="neofetch --seats" />
        <RosterPanel config={DEFAULT_CONFIG} />
      </div>
    </>
  )
}
```

- [ ] **Step 6: Wire up the page**

`app/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { TerminalWindow } from '@/components/terminal/TerminalWindow'
import { QueryScreen } from '@/components/screens/QueryScreen'

export default function Home() {
  const [query, setQuery] = useState<string | null>(null)

  return (
    <TerminalWindow path="~/session" statusLabel="idle" statusTone="ok">
      {query ? <p style={{ color: 'var(--sage)' }}>convening: {query}</p> : <QueryScreen onSubmit={setQuery} />}
    </TerminalWindow>
  )
}
```

Task 14 replaces the placeholder branch with the live deliberation view.

- [ ] **Step 7: Verify visually**

Run: `npm run dev` and open `http://localhost:3000`
Expected: the terminal frame with traffic-light dots, a 60px glowing `MODEL COUNCIL_` banner, the command box with a blinking caret, and four neofetch seat cards below. Scanlines visible over everything. No purple anywhere.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx app/globals.css components/screens components/roster
git commit -m "feat: query screen with glowing banner, command box, and neofetch roster"
```

---

### Task 14: Screen 2 — live deliberation

**Files:**
- Create: `components/screens/DeliberationScreen.tsx`, `components/deliberation/DraftColumn.tsx`, `components/deliberation/CritiqueList.tsx`, `components/deliberation/deliberation.module.css`, `lib/useCouncilStream.ts`
- Modify: `app/page.tsx` — replace the placeholder branch
- Test: `tests/lib/useCouncilStream.test.ts`

**Interfaces:**
- Consumes: `CouncilEvent` (Task 6), `parseEventStream` (Task 11), `CouncilConfig` (Task 2)
- Produces:
  - `type StreamState = { status: 'idle' | 'running' | 'done' | 'failed'; stage: Stage | null; drafts: Record<number, { text: string; status: 'streaming' | 'ok' | 'failed'; error?: string }>; critiques: Record<number, CritiqueOutput>; verdict: Verdict | null; confidenceAdjusted: boolean; runId: string | null; usage: Usage; error?: string }`
  - `function reduceEvent(state: StreamState, e: CouncilEvent): StreamState`
  - `function useCouncilStream(): { state: StreamState; start: (query: string, config: CouncilConfig) => void }`

- [ ] **Step 1: Write the failing reducer test**

The reducer is pure, so the whole live-UI behaviour is testable without a browser.

`tests/lib/useCouncilStream.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { reduceEvent, INITIAL_STATE } from '@/lib/useCouncilStream'
import type { CouncilEvent } from '@/council/events'
import { DEFAULT_CONFIG } from '@/council/config'

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

  it('marks the run done and totals usage', () => {
    const s = apply([
      { type: 'run_started', runId: 'r1', config: DEFAULT_CONFIG },
      { type: 'run_done', runId: 'r1', usage: { promptTokens: 700, completionTokens: 350, costUsd: 0.08 } },
    ])
    expect(s.status).toBe('done')
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/useCouncilStream.test.ts`
Expected: FAIL — cannot resolve `@/lib/useCouncilStream`

- [ ] **Step 3: Write the reducer and the hook**

`lib/useCouncilStream.ts`:
```ts
'use client'

import { useCallback, useState } from 'react'
import type { CouncilEvent, Stage } from '@/council/events'
import type { CouncilConfig } from '@/council/config'
import type { CritiqueOutput, Verdict } from '@/council/schemas'
import type { Usage } from '@/council/providers/types'
import { ZERO_USAGE } from '@/council/providers/types'
import { parseEventStream } from '@/lib/sse'

export type SeatView = { text: string; status: 'streaming' | 'ok' | 'failed'; error?: string }

export type StreamState = {
  status: 'idle' | 'running' | 'done' | 'failed'
  stage: Stage | null
  drafts: Record<number, SeatView>
  critiques: Record<number, CritiqueOutput>
  verdict: Verdict | null
  confidenceAdjusted: boolean
  runId: string | null
  usage: Usage
  error?: string
}

export const INITIAL_STATE: StreamState = {
  status: 'idle',
  stage: null,
  drafts: {},
  critiques: {},
  verdict: null,
  confidenceAdjusted: false,
  runId: null,
  usage: ZERO_USAGE,
}

function seat(state: StreamState, id: number): SeatView {
  return state.drafts[id] ?? { text: '', status: 'streaming' }
}

export function reduceEvent(state: StreamState, e: CouncilEvent): StreamState {
  switch (e.type) {
    case 'run_started':
      return { ...state, status: 'running', runId: e.runId }
    case 'stage_started':
      return { ...state, stage: e.stage }
    case 'seat_started':
      return { ...state, drafts: { ...state.drafts, [e.seat]: seat(state, e.seat) } }
    case 'token':
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [e.seat]: { ...seat(state, e.seat), text: seat(state, e.seat).text + e.text },
        },
      }
    case 'seat_done':
      return {
        ...state,
        drafts: { ...state.drafts, [e.seat]: { ...seat(state, e.seat), status: 'ok' } },
      }
    case 'seat_failed':
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [e.seat]: { ...seat(state, e.seat), status: 'failed', error: e.reason },
        },
      }
    case 'critique_done':
      return { ...state, critiques: { ...state.critiques, [e.seat]: e.payload } }
    case 'verdict':
      return { ...state, verdict: e.payload, confidenceAdjusted: e.confidenceAdjusted }
    case 'run_done':
      return { ...state, status: 'done', usage: e.usage }
    case 'run_failed':
      return { ...state, status: 'failed', error: e.reason }
    default:
      return state
  }
}

export function useCouncilStream() {
  const [state, setState] = useState<StreamState>(INITIAL_STATE)

  const start = useCallback(async (query: string, config: CouncilConfig) => {
    setState({ ...INITIAL_STATE, status: 'running' })

    const res = await fetch('/api/council', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, config }),
    })

    if (!res.ok || !res.body) {
      const detail = await res.text()
      setState((s) => ({ ...s, status: 'failed', error: detail.slice(0, 300) }))
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // Keep the trailing partial frame in the buffer.
      const lastBreak = buffer.lastIndexOf('\n\n')
      if (lastBreak === -1) continue
      const complete = buffer.slice(0, lastBreak + 2)
      buffer = buffer.slice(lastBreak + 2)
      for (const e of parseEventStream(complete)) {
        setState((s) => reduceEvent(s, e))
      }
    }
  }, [])

  return { state, start }
}
```

- [ ] **Step 4: Write the deliberation styles**

`components/deliberation/deliberation.module.css`:
```css
.columns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
@media (max-width: 900px) { .columns { grid-template-columns: 1fr; } }

.column {
  background: var(--panel);
  border: 1px solid var(--hairline);
  border-radius: 6px;
  padding: 14px;
  min-height: 220px;
  display: flex;
  flex-direction: column;
}
.column.failed { border-color: var(--danger); }

.head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.filename { color: var(--phosphor); text-shadow: var(--glow-soft); font-size: 13px; }
.meta { display: flex; align-items: baseline; gap: 10px; font-size: 11px; white-space: nowrap; }
.tokens { color: var(--amber); }
.perm { color: var(--phosphor-faint); }

.text { color: var(--sage); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 340px; overflow-y: auto; margin: 0; }
.errorText { color: var(--danger); font-size: 12px; }

.findings { list-style: none; padding: 0; margin: 10px 0 0; font-size: 12px; }
.findings li { color: var(--sage); margin: 4px 0; }
.gap::before { content: '[x] '; color: var(--phosphor); }
.err::before { content: '[!] '; color: var(--amber); }

.spinner { color: var(--phosphor); text-shadow: var(--glow-soft); font-size: 13px; }
```

- [ ] **Step 5: Write the deliberation components**

`components/deliberation/DraftColumn.tsx`:
```tsx
import { Caret } from '@/components/terminal/Caret'
import type { SeatView } from '@/lib/useCouncilStream'
import type { Seat } from '@/council/config'
import styles from './deliberation.module.css'

// Rough live estimate — the authoritative count arrives with seat_done.
const estimateTokens = (text: string) => Math.ceil(text.length / 4)

export function DraftColumn({ seat, view }: { seat: Seat; view?: SeatView }) {
  const v = view ?? { text: '', status: 'streaming' as const }
  return (
    <article className={`${styles.column} ${v.status === 'failed' ? styles.failed : ''}`}>
      <div className={styles.head}>
        <span className={styles.filename}>draft_{seat.id}.md</span>
        <span className={styles.meta}>
          <span className={styles.tokens}>{estimateTokens(v.text)} tok</span>
          <span className={styles.perm}>-rw-r--r--</span>
        </span>
      </div>
      {v.status === 'failed' ? (
        <p className={styles.errorText}>[!] seat failed: {v.error}</p>
      ) : (
        <p className={styles.text}>
          {v.text}
          {v.status === 'streaming' ? <Caret /> : null}
        </p>
      )}
    </article>
  )
}
```

`components/deliberation/CritiqueList.tsx`:
```tsx
import type { CritiqueOutput } from '@/council/schemas'
import styles from './deliberation.module.css'

export function CritiqueList({ critiques }: { critiques: Record<number, CritiqueOutput> }) {
  const entries = Object.entries(critiques)
  if (entries.length === 0) return null

  return (
    <div className={styles.columns}>
      {entries.map(([seatId, payload]) => (
        <article key={seatId} className={styles.column}>
          <div className={styles.head}>
            <span className={styles.filename}>critique_{seatId}.json</span>
          </div>
          <ul className={styles.findings}>
            {payload.critiques.flatMap((peer, i) => [
              ...peer.gaps.map((g, j) => (
                <li key={`g${i}-${j}`} className={styles.gap}>
                  {g}
                </li>
              )),
              ...peer.factual_errors.map((f, j) => (
                <li key={`f${i}-${j}`} className={styles.err}>
                  {f}
                </li>
              )),
            ])}
          </ul>
        </article>
      ))}
    </div>
  )
}
```

`components/screens/DeliberationScreen.tsx`:
```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CommandLine } from '@/components/terminal/CommandLine'
import { DraftColumn } from '@/components/deliberation/DraftColumn'
import { CritiqueList } from '@/components/deliberation/CritiqueList'
import { useCouncilStream } from '@/lib/useCouncilStream'
import { DEFAULT_CONFIG } from '@/council/config'
import styles from '@/components/deliberation/deliberation.module.css'

export function DeliberationScreen({ query }: { query: string }) {
  const { state, start } = useCouncilStream()
  const router = useRouter()

  useEffect(() => {
    void start(query, DEFAULT_CONFIG)
  }, [query, start])

  // The verdict lives at its own URL so the run is shareable — spec section 14.
  useEffect(() => {
    if (state.status === 'done' && state.runId) router.push(`/run/${state.runId}`)
  }, [state.status, state.runId, router])

  return (
    <>
      <CommandLine command="council dispatch --seats 3 --blind" />
      <div className={styles.columns}>
        {DEFAULT_CONFIG.drafters.map((seat) => (
          <DraftColumn key={seat.id} seat={seat} view={state.drafts[seat.id]} />
        ))}
      </div>

      {state.stage === 'critique' || Object.keys(state.critiques).length > 0 ? (
        <>
          <CommandLine command="council critique --anonymize --shuffle" />
          <CritiqueList critiques={state.critiques} />
        </>
      ) : null}

      {state.stage === 'judge' ? (
        <>
          <CommandLine command="council judge --strict" />
          <p className={styles.spinner}>deliberating [/-\|] synthesizing verdict...</p>
        </>
      ) : null}

      {state.status === 'failed' ? (
        <p style={{ color: 'var(--danger)', marginTop: 20 }}>[!] run failed: {state.error}</p>
      ) : null}
    </>
  )
}
```

- [ ] **Step 6: Wire the deliberation screen into the page**

Replace the placeholder branch in `app/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { TerminalWindow } from '@/components/terminal/TerminalWindow'
import { QueryScreen } from '@/components/screens/QueryScreen'
import { DeliberationScreen } from '@/components/screens/DeliberationScreen'

export default function Home() {
  const [query, setQuery] = useState<string | null>(null)

  return (
    <TerminalWindow
      path="~/session"
      statusLabel={query ? 'council in session' : 'idle'}
      statusTone={query ? 'live' : 'ok'}
    >
      {query ? <DeliberationScreen query={query} /> : <QueryScreen onSubmit={setQuery} />}
    </TerminalWindow>
  )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/useCouncilStream.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 8: Commit**

```bash
git add lib/useCouncilStream.ts components/deliberation components/screens/DeliberationScreen.tsx app/page.tsx tests/lib/useCouncilStream.test.ts
git commit -m "feat: live deliberation screen with three streaming draft columns"
```

---

### Task 15: Screen 3 — the shareable verdict

**Files:**
- Create: `app/run/[id]/page.tsx`, `components/verdict/VerdictView.tsx`, `components/verdict/ContestedSection.tsx`, `components/verdict/ProvenanceList.tsx`, `components/verdict/verdict.module.css`
- Create: `lib/markdown.ts`
- Test: `tests/lib/markdown.test.ts`

**Interfaces:**
- Consumes: `loadRun` (Task 10), `RunRecord` (Task 9), `Verdict` (Task 2), `BarMeter`, `TerminalWindow`, `CommandLine` (Task 12)
- Produces:
  - `function renderMarkdown(md: string): string` — a minimal, escaped subset renderer
  - `<VerdictView run />`, `<ContestedSection contested />`, `<ProvenanceList provenance />`

- [ ] **Step 1: Write the failing markdown test**

The verdict is model-generated text rendered into the page, so escaping is a
security requirement, not a nicety. A dependency-free renderer over a known
subset keeps the attack surface small and the test honest.

`tests/lib/markdown.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '@/lib/markdown'

describe('renderMarkdown', () => {
  it('renders headings', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>')
    expect(renderMarkdown('## Sub')).toContain('<h2>Sub</h2>')
  })

  it('renders bold and inline code', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>')
    expect(renderMarkdown('`code`')).toContain('<code>code</code>')
  })

  it('renders unordered lists', () => {
    const out = renderMarkdown('- one\n- two')
    expect(out).toContain('<li>one</li>')
    expect(out).toContain('<li>two</li>')
  })

  it('escapes raw html so model output cannot inject script', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes html inside a code span', () => {
    expect(renderMarkdown('`<img onerror=x>`')).not.toContain('<img')
  })

  it('escapes an attribute-injection attempt in a heading', () => {
    expect(renderMarkdown('# <a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
  })

  it('leaves plain paragraphs intact', () => {
    expect(renderMarkdown('just words')).toContain('<p>just words</p>')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/markdown.test.ts`
Expected: FAIL — cannot resolve `@/lib/markdown`

- [ ] **Step 3: Write the renderer**

`lib/markdown.ts`:
```ts
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A deliberately tiny markdown subset. Everything is escaped first, so no
 * model-generated string can inject markup. Adding a full markdown library
 * here would widen the attack surface for very little gain.
 */
export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split('\n')
  const out: string[] = []
  let inList = false

  const inline = (s: string) =>
    s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  for (const raw of lines) {
    const line = raw.trimEnd()

    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }
    if (inList) { out.push('</ul>'); inList = false }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (line.trim() === '') continue
    out.push(`<p>${inline(line)}</p>`)
  }

  if (inList) out.push('</ul>')
  return out.join('\n')
}
```

- [ ] **Step 4: Write the verdict styles**

`components/verdict/verdict.module.css`:
```css
.answer { color: var(--sage); font-size: 14px; }
.answer h1, .answer h2, .answer h3 { color: var(--ink); text-shadow: var(--glow-soft); }
.answer h1 { font-size: 22px; }
.answer h2 { font-size: 17px; }
.answer code { color: var(--phosphor); background: #000; padding: 1px 5px; border-radius: 3px; }
.answer strong { color: var(--ink); }

.provenance { display: grid; grid-template-columns: 1fr 110px 90px; gap: 6px 14px; font-size: 12px; align-items: baseline; }
.claim { color: var(--sage); }
.support { color: var(--phosphor); }
.supportSingle { color: var(--amber); }
.seats { color: var(--phosphor-faint); text-align: right; }

.contested {
  border: 1px solid var(--amber);
  border-radius: 6px;
  padding: 18px;
  background: rgba(255, 210, 74, 0.03);
}
.contestedTitle { color: var(--amber); text-shadow: var(--glow-amber); font-size: 13px; margin-bottom: 14px; }
.contestedItem { margin: 0 0 18px; }
.point { color: var(--ink); font-size: 13px; }
.point::before { content: '[!] '; color: var(--amber); }
.position { color: var(--sage); font-size: 12px; margin-left: 18px; }
.ruling { color: var(--phosphor); font-size: 12px; margin-left: 18px; margin-top: 5px; }
.ruling::before { content: 'ruling: '; color: var(--phosphor-faint); }

.unanimous { color: var(--phosphor); font-size: 12px; }

.footer {
  border-top: 1px solid var(--hairline);
  margin-top: 36px;
  padding-top: 14px;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--phosphor-faint);
  gap: 16px;
  flex-wrap: wrap;
}
.degraded { color: var(--danger); font-size: 12px; margin-bottom: 16px; }
.degraded::before { content: '[!] '; }
```

- [ ] **Step 5: Write the verdict components**

`components/verdict/ProvenanceList.tsx`:
```tsx
import type { Verdict } from '@/council/schemas'
import styles from './verdict.module.css'

export function ProvenanceList({ provenance }: { provenance: Verdict['provenance'] }) {
  if (provenance.length === 0) return null
  return (
    <div className={styles.provenance}>
      {provenance.map((p, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <span className={styles.claim}>{p.claim}</span>
          <span className={p.support === 'single' ? styles.supportSingle : styles.support}>
            {p.support}
          </span>
          <span className={styles.seats}>seats {p.seats.join(',') || '-'}</span>
        </div>
      ))}
    </div>
  )
}
```

`components/verdict/ContestedSection.tsx`:
```tsx
import type { Verdict } from '@/council/schemas'
import styles from './verdict.module.css'

// Expanded by default. This is the reason the product exists — spec 11.4.
export function ContestedSection({ contested }: { contested: Verdict['contested'] }) {
  if (contested.length === 0) {
    return <p className={styles.unanimous}>[x] no contested points. the council agreed.</p>
  }

  return (
    <section className={styles.contested}>
      <div className={styles.contestedTitle}>
        CONTESTED ({contested.length}) // where the council disagreed
      </div>
      {contested.map((c, i) => (
        <div key={i} className={styles.contestedItem}>
          <div className={styles.point}>{c.point}</div>
          {c.positions.map((p, j) => (
            <div key={j} className={styles.position}>
              seat {p.seat}: {p.position}
            </div>
          ))}
          <div className={styles.ruling}>
            {c.ruling} — {c.reasoning}
          </div>
        </div>
      ))}
    </section>
  )
}
```

`components/verdict/VerdictView.tsx`:
```tsx
import type { RunRecord } from '@/council/orchestrator'
import { CommandLine, Rule } from '@/components/terminal/CommandLine'
import { BarMeter } from '@/components/terminal/BarMeter'
import { renderMarkdown } from '@/lib/markdown'
import { ProvenanceList } from './ProvenanceList'
import { ContestedSection } from './ContestedSection'
import styles from './verdict.module.css'

const CONFIDENCE_VALUE = { high: 90, medium: 60, low: 30 } as const

export function VerdictView({ run }: { run: RunRecord }) {
  const failedSeats = run.stages.drafts.filter((d) => d.status === 'failed')
  const calls = run.stages.drafts.length + run.stages.critiques.length + 1
  const totalTokens = run.usage.promptTokens + run.usage.completionTokens

  if (!run.verdict) {
    return (
      <>
        <CommandLine command={`council show ${run.id}`} />
        <p className={styles.degraded}>run failed: {run.error ?? 'unknown error'}</p>
      </>
    )
  }

  return (
    <>
      <CommandLine command={`council show ${run.id}`} />
      <p style={{ color: 'var(--phosphor-faint)', fontSize: 12 }}>{run.query}</p>

      {run.status === 'degraded' ? (
        <p className={styles.degraded}>
          degraded run: {failedSeats.length} seat(s) failed —{' '}
          {failedSeats.map((s) => `seat ${s.seatId}`).join(', ')}. the verdict was synthesized from
          the survivors.
        </p>
      ) : null}

      <Rule />
      <CommandLine command="cat verdict.md" />
      <div
        className={styles.answer}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(run.verdict.answer_markdown) }}
      />

      <Rule />
      <CommandLine command="council provenance --by-claim" />
      <ProvenanceList provenance={run.verdict.provenance} />

      <Rule />
      <CommandLine command="council contested --expand" />
      <ContestedSection contested={run.verdict.contested} />

      <Rule />
      <CommandLine command="council confidence" />
      <BarMeter
        label="confidence"
        value={CONFIDENCE_VALUE[run.verdict.confidence]}
        display={run.verdict.confidence}
      />
      {run.confidenceAdjusted ? (
        <p style={{ color: 'var(--amber)', fontSize: 12, marginTop: 8 }}>
          [!] the judge claimed high confidence, but too many claims rest on a single seat. adjusted
          down.
        </p>
      ) : null}

      <div className={styles.footer}>
        <span>
          $ echo &quot;model council // {run.status}&quot;
        </span>
        <span>
          {run.stages.drafts.length + 1} seats, {calls} calls, {(totalTokens / 1000).toFixed(1)}k tok,
          ${run.usage.costUsd.toFixed(3)}, {(run.elapsedMs / 1000).toFixed(0)}s
        </span>
      </div>
    </>
  )
}
```

- [ ] **Step 6: Write the run page**

`app/run/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation'
import { TerminalWindow } from '@/components/terminal/TerminalWindow'
import { VerdictView } from '@/components/verdict/VerdictView'
import { loadRun } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = await loadRun(id)
  if (!run) notFound()

  return (
    <TerminalWindow
      path={`~/runs/${id.slice(0, 8)}`}
      statusLabel={run.status}
      statusTone={run.status === 'failed' ? 'failed' : 'ok'}
    >
      <VerdictView run={run} />
    </TerminalWindow>
  )
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/markdown.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 8: Commit**

```bash
git add app/run components/verdict lib/markdown.ts tests/lib/markdown.test.ts
git commit -m "feat: shareable verdict page with provenance and amber contested section"
```

---

### Task 16: Live smoke test, README, and deployment

**Files:**
- Create: `tests/live/smoke.test.ts`, `README.md`, `vercel.json`
- Modify: `prisma/schema.prisma` — document the Postgres swap

**Interfaces:**
- Consumes: everything
- Produces: a verified end-to-end run against real models, and a deployable app

- [ ] **Step 1: Write the live smoke test**

Gated behind an env flag so CI never burns credits — spec §12.

`tests/live/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runCouncil } from '@/council/orchestrator'
import { createOpenRouterProvider } from '@/council/providers/openrouter'
import { DEFAULT_CONFIG } from '@/council/config'

const live = process.env.RUN_LIVE_TESTS === '1' && !!process.env.OPENROUTER_API_KEY

describe.skipIf(!live)('live council run', () => {
  it(
    'completes a real four-model run and produces a verdict',
    async () => {
      const provider = createOpenRouterProvider(process.env.OPENROUTER_API_KEY!)
      const run = await runCouncil(
        'Should a small team choose Postgres or SQLite for a new B2B SaaS? Answer in under 200 words.',
        DEFAULT_CONFIG,
        provider,
        () => {},
      )

      expect(['complete', 'degraded']).toContain(run.status)
      expect(run.verdict).not.toBeNull()
      expect(run.verdict!.answer_markdown.length).toBeGreaterThan(100)
      expect(run.verdict!.provenance.length).toBeGreaterThan(0)
      expect(run.usage.costUsd).toBeGreaterThan(0)

      // The council must actually cost what the spec claims — a regression
      // here means a seat was swapped for something far more expensive.
      expect(run.usage.costUsd).toBeLessThan(0.5)

      console.log(
        `status=${run.status} cost=$${run.usage.costUsd.toFixed(4)} ` +
          `tokens=${run.usage.promptTokens + run.usage.completionTokens} ` +
          `elapsed=${(run.elapsedMs / 1000).toFixed(1)}s ` +
          `contested=${run.verdict!.contested.length}`,
      )
    },
    180_000,
  )
})
```

- [ ] **Step 2: Run the live test once, by hand**

```bash
RUN_LIVE_TESTS=1 npx vitest run tests/live/smoke.test.ts
```

Expected: PASS in 30–90s, with a logged cost between $0.03 and $0.20. If the
cost is materially higher, check that no seat silently resolved to a `-pro`
model. If `status=degraded`, read which seat failed before continuing — a
consistently failing seat usually means a stale model id.

- [ ] **Step 3: Add the npm script**

```bash
npm pkg set scripts.test:live="RUN_LIVE_TESTS=1 vitest run tests/live/smoke.test.ts"
```

- [ ] **Step 4: Write the README**

`README.md`:
````markdown
# Model Council

Four models. One verdict.

One question is answered independently by three models from three different
labs. They then critique each other's answers blind and revise their own. A
fourth model, which wrote no draft, synthesizes the result and reports where
the council disagreed.

That disagreement report is the point. It is a signal a single model cannot
structurally produce.

## The protocol

```
R1  DISPATCH   3 drafters answer in parallel, in isolation.
R2  CRITIQUE   Each drafter sees the others anonymized and shuffled,
               critiques them, then revises its own answer.
R3  JUDGE      A fourth model synthesizes drafts, critiques, and revisions.
```

Anonymization matters: models measurably favour their own and familiar
outputs. Peer drafts are labelled `Draft A` / `Draft B`, shuffled
independently per critic, with self-identifying phrases stripped. The judge
sees seat numbers, never model names.

## Roster

| Seat | Model | Lab |
| --- | --- | --- |
| 1 | `anthropic/claude-sonnet-5` | Anthropic |
| 2 | `openai/gpt-5.4` | OpenAI |
| 3 | `google/gemini-3.1-pro-preview` | Google |
| Judge | `x-ai/grok-4.6` | xAI |

Four labs, so no lab both drafts and judges. About $0.08 per run.

## Setup

```bash
npm install
cp .env.example .env      # add your OPENROUTER_API_KEY
npx prisma migrate dev
npm run dev
```

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Start the app on :3000 |
| `npm test` | Full suite, no network calls |
| `npm run test:live` | One real four-model run (costs ~$0.08) |

## Architecture

The council engine depends only on a narrow `Provider` interface, so the
whole protocol is tested against deterministic fakes with no network access.
`app/api/council/route.ts` is a thin SSE adapter over it. Wrapping the same
engine as a CLI or MCP server needs no changes to its logic.

Failure policy: a single seat failing degrades the run rather than killing
it. Quorum is two drafters plus the judge. If the judge fails, the run fails
— promoting a drafter would reintroduce the self-preference bias the roster
exists to prevent.

Design: `docs/specs/2026-09-01-model-council-design.md`
````

- [ ] **Step 5: Document the Postgres swap**

Append to `prisma/schema.prisma` as a comment:
```prisma
// Production: change provider to "postgresql" and point DATABASE_URL at Neon.
// The String JSON blobs work unchanged; switching them to Json is optional
// and only affects lib/db.ts serialize/deserialize.
```

`vercel.json`:
```json
{
  "buildCommand": "prisma generate && next build",
  "functions": { "app/api/council/route.ts": { "maxDuration": 300 } }
}
```

- [ ] **Step 6: Run the full suite and build**

```bash
npm test
npm run build
```

Expected: all suites pass, build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add README.md vercel.json tests/live prisma/schema.prisma package.json
git commit -m "feat: live smoke test, README, and Vercel deployment config"
```

---

## Verification

After Task 16 the following must all hold:

1. `npm test` passes with zero network calls.
2. `npm run test:live` produces a real verdict for under $0.20.
3. `npm run build` succeeds with no type errors.
4. A run started at `/` streams three columns, then redirects to `/run/[id]`.
5. Opening `/run/[id]` in a fresh browser shows the verdict — the share link works.
6. Killing one seat's model id (set it to `nonexistent/model`) degrades the run rather than failing it.
7. Killing two seats fails the run with a quorum message and never calls the judge.
8. No purple or indigo appears anywhere in the rendered page.
