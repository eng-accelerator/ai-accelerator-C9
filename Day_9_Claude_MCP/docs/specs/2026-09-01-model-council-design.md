# Model Council — Design

Date: 2026-09-01
Status: Approved, pending implementation plan

## 1. Problem

Asking one model a hard question gives you one answer with no error bars. You
cannot tell which parts are load-bearing consensus and which are that model's
idiosyncratic guess. Asking several models separately gives you three answers
and a manual diffing job.

Model Council runs a structured deliberation across four models from four
different labs and returns one synthesized answer, annotated with where the
members agreed, where they conflicted, and how the conflict was resolved.

The disagreement report is the product. It is a signal a single model cannot
structurally produce.

## 2. Goals

- Produce a better answer than any single council member would have produced.
- Surface inter-model disagreement as an explicit, first-class output.
- Make the deliberation legible: the user watches it happen, then shares a URL.
- Deploy as a real hosted app, not a localhost demo.

## 3. Non-goals

Deliberately out of scope for v1. All are additive later; none are required to
prove the idea.

- Authentication and user accounts
- Multi-turn conversation (each run is one query)
- Tool use, web search, or RAG in council members
- More than one critique round (no iterated debate)
- Token-by-token streaming of the judge verdict
- Embedding/vector similarity for consensus scoring
- Mobile-first layout (responsive degradation only)

## 4. The protocol

Four models. Three write, one judges. Three rounds.

```
R1  DISPATCH   3 drafters answer the query in parallel, in isolation.
               No drafter knows the others exist.

R2  CRITIQUE   3 calls in parallel. Each drafter receives the other two
               drafts, anonymized and per-critic shuffled. It returns
               structured critiques of both peers, then revises its own
               answer using what it learned.

R3  JUDGE      1 call. The judge (which wrote no draft) receives all 3
               drafts, all 6 critiques, and all 3 revisions, seat-labeled
               only. It returns a structured verdict.
```

### 4.1 Why this shape

- **Independent drafts first.** Any shared context before drafting collapses
  diversity, which is the only thing a council has over a single model.
- **Anonymized critique.** Models exhibit measurable brand and self-preference
  bias. Labels are stripped so critique targets content.
- **Revision after critique.** The largest single quality gain in the protocol.
  Models are good at repairing their own gaps once a gap is named for them.
- **Judge wrote no draft.** Removes self-preference from the step where
  impartiality matters most.

### 4.2 Anti-groupthink mechanisms

These are requirements, not suggestions. Without them the council converges to
consensus mush and is worth less than one good model.

1. **Blind labels.** Peer drafts are presented as `Draft A` / `Draft B`. The
   A/B assignment is shuffled independently per critic per run, so ordinal
   position never correlates with seat identity.
2. **No self-identification.** The draft system prompt forbids naming the model
   or its lab. A post-hoc regex scrub removes leaked self-references
   (case-insensitive match on known lab and model names) before drafts are
   passed to critics or the judge.
3. **Adversarial critique contract.** The critique JSON schema requires at
   minimum one `gap` and one `risk` per peer draft. Empty arrays fail
   validation and trigger a repair round-trip. A critic cannot pass by saying
   the peer looks good.
4. **Judge sees seats, not brands.** The judge prompt uses `Seat 1/2/3`.
   Anonymization is a property of prompts only — the user always sees which
   model holds which seat. It is the models that never learn it.

## 5. Council roster

Defaults, verified live against the OpenRouter catalog on 2026-09-01. All
seats are user-overridable at runtime.

| Seat    | Model                          | Lab       | In $/M |
| ------- | ------------------------------ | --------- | ------ |
| Seat 1  | `anthropic/claude-sonnet-5`    | Anthropic | 2.00   |
| Seat 2  | `openai/gpt-5.4`               | OpenAI    | 2.50   |
| Seat 3  | `google/gemini-3.1-pro-preview`| Google    | 2.00   |
| Judge   | `x-ai/grok-4.6`                | xAI       | 2.00   |

Four labs, so no lab both drafts and judges. Estimated cost is $0.05–0.12 per
run at typical query sizes, cheap enough to demo without cost anxiety.

The roster panel lets any seat be swapped from OpenRouter's `/api/v1/models`
catalog. Swapping the judge to a lab already holding a drafter seat is allowed
but shows an inline warning about self-preference bias.

## 6. Architecture

Single Next.js (App Router, TypeScript) application.

```
model-council/
  app/
    page.tsx                  Screen 1 — query + roster
    run/[id]/page.tsx         Screen 3 — shareable verdict
    api/council/route.ts      SSE endpoint, adapts orchestrator to HTTP
    api/models/route.ts       Cached proxy of OpenRouter model catalog
  council/
    orchestrator.ts           Pure async protocol driver
    stages/draft.ts
    stages/critique.ts
    stages/judge.ts
    anonymize.ts              Shuffle, relabel, scrub self-references
    schemas.ts                Zod schemas for every structured payload
    providers/openrouter.ts   Provider implementation
    providers/types.ts        Provider interface
    config.ts                 Default roster + tunables
    prompts/                  One file per stage
  components/                 UI, theme-driven
  lib/db.ts                   Prisma client
  styles/theme.css            All design tokens as CSS custom properties
  prisma/schema.prisma
```

### 6.1 Module boundaries

**`Provider`** is the seam that makes everything else testable.

```ts
interface CompleteRequest {
  model: string
  system: string
  user: string
  json?: boolean          // request response_format: json_object
  signal?: AbortSignal
}

interface Provider {
  // R2, R3 — single structured response
  complete(req: CompleteRequest): Promise<Completion>
  // R1 only — token deltas; resolves to the same Completion shape when done
  stream(req: CompleteRequest): AsyncIterable<Delta> & { done: Promise<Completion> }
}
```

Two explicit methods rather than one polymorphic call, so a caller never has
to branch on the return type. `Completion` carries `{ text, usage, model }`.

`orchestrator.ts` depends only on this interface, never on `fetch` or on
OpenRouter. Tests inject deterministic fake providers. The real
`openrouter.ts` is the only module that knows about HTTP, API keys, or
vendor response shapes.

**`orchestrator.ts`** is a pure async function:
`runCouncil(query, config, provider, emit) => Promise<Run>`. It owns stage
sequencing, parallelism, partial-failure policy, and usage accounting. It
emits progress events through the `emit` callback and knows nothing about SSE.

**`api/council/route.ts`** is a thin adapter: it constructs the real provider,
calls `runCouncil`, forwards `emit` events onto a `ReadableStream` as SSE, and
persists the finished run.

This layering means the council engine can later be wrapped as an MCP server
or a CLI without touching any of its logic.

## 7. Structured payloads

All model outputs that drive UI are JSON, validated with Zod. Requests set
`response_format: { type: 'json_object' }` where the model supports it. On
validation failure the orchestrator issues exactly one repair call, echoing
the validation error back to the model. A second failure fails that seat.

### 7.1 Critique output (per critic)

```ts
{
  critiques: [{
    target: 'A' | 'B',
    strengths: string[],        // >= 1
    gaps: string[],             // >= 1, enforced
    risks: string[],            // >= 1, enforced
    factual_errors: string[]    // may be empty
  }],                           // exactly 2 entries
  revised_answer: string        // markdown
}
```

### 7.2 Verdict output (judge)

```ts
{
  answer_markdown: string,
  provenance: [{
    claim: string,
    support: 'unanimous' | 'majority' | 'single',
    seats: number[]
  }],
  contested: [{
    point: string,
    positions: [{ seat: number, position: string }],
    ruling: string,
    reasoning: string
  }],
  confidence: 'high' | 'medium' | 'low'
}
```

`confidence` is validated against the provenance distribution rather than
trusted blindly: a verdict claiming `high` while more than a third of its
claims are `single`-supported is downgraded by the orchestrator, and the
adjustment is recorded on the run. Confidence is a property of the council,
not an assertion by one model.

## 8. Data model

One table. The protocol is still moving, so stage payloads are JSON blobs
rather than normalized rows. This avoids migration churn without costing
anything at prototype scale.

```prisma
model Run {
  id        String   @id @default(cuid())
  query     String
  config    Json     // roster: seats + judge, model ids
  status    String   // running | complete | failed | degraded
  stages    Json     // { drafts[], critiques[], revisions[] }
  verdict   Json?    // null until R3 completes
  usage     Json     // per-seat tokens, cost, latency; run totals
  error     String?
  createdAt DateTime @default(now())
}
```

SQLite locally via `DATABASE_URL="file:./dev.db"`. Production swaps the same
variable to a Neon Postgres URL; Prisma's provider is the only other change.

## 9. SSE event contract

The route emits newline-delimited JSON events. Event order is part of the
contract and is covered by tests.

```
{ type: 'run_started',  runId, config }
{ type: 'stage_started', stage: 'draft'|'critique'|'judge' }
{ type: 'seat_started',  seat, model }
{ type: 'token',         seat, text }            // R1 drafts only
{ type: 'seat_done',     seat, usage }
{ type: 'seat_failed',   seat, reason }
{ type: 'critique_done', seat, payload }
{ type: 'stage_done',    stage }
{ type: 'verdict',       payload }
{ type: 'run_done',      runId, usage }
```

Only R1 drafts stream tokens. Critique and judge are single structured calls
delivered whole, because partial JSON is not renderable.

## 10. Error handling

A single seat failing must never kill the run.

- Every call gets a 90s timeout and one retry on network error, 429, or 5xx,
  with jittered backoff.
- A seat that still fails is marked `failed`. The protocol continues with the
  survivors. Critics receive only the drafts that exist.
- Malformed JSON gets one repair round-trip (section 7) before the seat fails.
- **Quorum: two drafters plus the judge.** Below that the run is marked
  `failed` and no verdict is produced, because a "council" of one is a lie.
- If the judge itself fails after retry, the run is `failed` — there is no
  fallback promotion of a drafter to judge, since that reintroduces exactly the
  self-preference bias the roster design exists to avoid.
- Any run completing with a failed seat is `degraded`. The UI shows the failed
  seat in traffic-light red and the verdict carries a visible degradation note.
- Missing `OPENROUTER_API_KEY` fails fast at startup with an actionable message.

## 11. UI

The full CRT terminal design system, applied to Council's screens. Tokens live
in `styles/theme.css` as CSS custom properties so the palette is swappable
from one file.

### 11.1 Design system

- **Canvas.** Pure black `#000000`, washed with two faint green radial glows
  (`rgba(57,255,122,0.08)` top-right, `rgba(57,255,122,0.05)` left).
- **CRT overlay.** Fixed, `pointer-events: none`, high z-index, painted with a
  repeating-linear-gradient of faint horizontal lines at ~3–4px pitch,
  `mix-blend-mode: multiply`, opacity ~0.5.
- **Palette.** Phosphor green `#39ff7a` is the single accent, carried by
  text-shadow glow. Support greens `#2bbf5c` and `#1c7a3c`. Body sage
  `#5f8d68`. Headings near-white `#eafff1`. Panels `#050805` / `#070b07`,
  hairlined `#143614` / `#1f4d1f`. Radii 3–8px only.
- **Amber `#ffd24a` is semantic: contested / needs attention.** This is a
  deliberate extension of the source theme, where amber was decorative. It
  marks contested verdict points, the live run-status dot, and highlighted
  tags. Failed seats use `#ff5f56`, already present as a traffic-light dot, so
  no new color family is introduced.
- **Type.** Monospace everywhere: JetBrains Mono (400–800, primary) + IBM Plex
  Mono (secondary), via `next/font/google`. Hierarchy from size, weight, and
  glow — never a second typeface.
- **Glow.** `.glow` = `0 0 8px rgba(57,255,122,0.45), 0 0 24px rgba(57,255,122,0.18)`.
  A softer `.glow-soft` for green body accents. Used sparingly.
- **Furniture.** Terminal window frame around the whole app, `$` command
  prefixes on every section, `[x]` bracket bullets, blinking block carets,
  `::selection` at `rgba(57,255,122,0.30)`.
- **No** purple/indigo, no Inter, no emoji headings, no stock imagery, no
  centered-everything layout. Left-aligned and command-driven throughout.

The ~60px banner must be scoped to a class with explicit `font-size !important`,
since preview hosts override bare `h1`.

### 11.2 Screen 1 — query

Terminal window frame, path label `council@openrouter: ~/session`, right-aligned
nav, amber status blip reporting live run state.

Body opens with `council~/session $ council --version`, then the ~60px glowing
banner `MODEL COUNCIL_` with a green underscore cursor, the role line
`> four models. one verdict.`, a sage intro, and a wrap of `[x]` meta checks
(seats configured, estimated cost, average latency).

The query input is the command box: a near-black inset, dim-green border, green
glow, a green `$` prefix, and a blinking green block caret. Submit is a solid
glowing green `$ council ask ->` button beside a ghost `--configure`.

Below, the roster panel: four neofetch-style cards, one per seat, with a green
pixel ASCII avatar and a key/value block (`Model`, `Lab`, `Context`, `Cost`,
`Status`) in green keys and sage values, `Status` in amber. Collapsible.

### 11.3 Screen 2 — deliberation

The centerpiece. Under `council~/session $ council dispatch --seats 3 --blind`,
three framed cards stream side by side, each with a live blinking caret and a
ticking token counter where the source theme put a star count, plus a faint
permission string `-rw-r--r--`. This is genuinely `tail -f` on three logs and
the terminal treatment is load-bearing rather than decorative.

Then `council~/session $ council critique --anonymize --shuffle`: findings
render as bracket bullets, `[x]` for gaps and `[!]` in amber for factual
errors, shown against anonymized labels while the stage runs.

Then `council~/session $ council judge --strict` with an ASCII spinner.

### 11.4 Screen 3 — verdict, `/run/[id]`

Near-white synthesized answer with green-highlighted key claims. Provenance as
a definition list, green keys and sage values, support level as a small tag.
**The contested section is amber and expanded by default** — it is the reason
the product exists. Confidence renders as an ASCII bar meter, the source
theme's skill meter reused honestly.

Footer keeps the fake git status line, made real:
`4 seats, 10 calls, 34.2k tok, $0.08, 41s`.

### 11.5 Responsive

Desktop-first at ~1120px content width. Below ~900px the nav collapses, the
three draft columns stack to one, and the roster cards go single-column. No
mobile-specific design work beyond this.

## 12. Testing

Vitest. The `Provider` seam means the entire protocol is testable without
network access.

- **Orchestrator** against deterministic fake providers: stage ordering,
  parallelism within a stage, usage accounting.
- **Anonymization**: labels are stripped, A/B assignment differs across
  critics, self-references are scrubbed, no seat identity leaks into any
  critic or judge prompt. This is the correctness core and gets the most cases.
- **Partial failure**: one drafter fails, two fail (quorum breach), judge
  fails, malformed JSON repaired, malformed JSON twice.
- **Confidence adjustment**: overclaimed `high` is downgraded.
- **SSE**: event sequence and shape against the contract in section 9.
- **Live smoke test** hitting real OpenRouter, gated behind
  `RUN_LIVE_TESTS=1` so CI never burns credits.

## 13. Configuration

```
OPENROUTER_API_KEY   required
DATABASE_URL         required — file:./dev.db locally, Neon URL in prod
COUNCIL_TIMEOUT_MS   optional, default 90000
RUN_LIVE_TESTS       optional, enables the live smoke test
```

Roster defaults live in `council/config.ts` and are overridable per run from
the UI.

## 14. Deployment

Vercel. `DATABASE_URL` points at Neon Postgres, `OPENROUTER_API_KEY` set as a
project secret. The SSE route runs on the Node runtime, not Edge, because run
durations exceed Edge limits. `/run/[id]` is server-rendered and publicly
readable by URL, which is what makes a run shareable.
