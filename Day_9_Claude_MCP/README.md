# Model Council

Four models from four labs answer one question. Three write independently, critique each other blind, and revise. A fourth model — which wrote no draft — synthesizes a verdict and names where they disagreed.

The disagreement report is the product. A single model cannot structurally produce it.

**Live locally:** [http://localhost:3000](http://localhost:3000) after setup.

## How a run works

```
R1  DISPATCH   Three drafters answer in parallel, in isolation.
               No drafter knows the others exist.

R2  CRITIQUE   Each drafter sees the other two drafts as Draft A / Draft B
               (shuffled per critic). It must name at least one gap and
               one risk per peer, then revises its own answer.

R3  JUDGE      A fourth model receives seat-labeled drafts, critiques, and
               revisions — never model names — and returns a verdict with
               provenance and a contested section.
```

You watch R1 stream token-by-token in three columns. Critique and judge arrive as complete structured payloads. When the run finishes, the browser opens `/run/[id]` — a shareable verdict page.

Typical cost is about **$0.05–0.12** per run. A live smoke test against real models costs about **$0.08**.

## Default roster

| Seat | Model | Lab | Role |
| --- | --- | --- | --- |
| 1 | `anthropic/claude-sonnet-5` | Anthropic | Drafter |
| 2 | `openai/gpt-5.4` | OpenAI | Drafter |
| 3 | `google/gemini-3.1-pro-preview` | Google | Drafter |
| Judge | `x-ai/grok-4.6` | xAI | Judge only |

Four labs, so no lab both drafts and judges. Defaults live in `council/config.ts` and were checked against the OpenRouter catalog on 2026-09-01.

## Setup

You need Node 20+, npm, and an [OpenRouter](https://openrouter.ai) API key.

```bash
git clone https://github.com/kvsdileep/model-council-next.git
cd model-council-next
npm install
cp .env.example .env
```

Edit `.env` and set `OPENROUTER_API_KEY`. Do not commit `.env`.

```bash
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), type a question, and submit `$ council ask ->`. A full run usually takes one to two minutes.

`npx prisma migrate dev` needs `DATABASE_URL` from `.env` (the example uses local SQLite: `file:./dev.db`).

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | — | OpenRouter key. Missing key fails the council route with an actionable 500. |
| `DATABASE_URL` | yes | `file:./dev.db` | Prisma datasource. SQLite locally. |
| `COUNCIL_TIMEOUT_MS` | no | `90000` | Per-call timeout. |
| `RUN_LIVE_TESTS` | no | unset | Set to `1` to enable the live OpenRouter smoke test. |

`.env` is gitignored. `.env.example` is the only env file in the repo.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on [http://localhost:3000](http://localhost:3000) |
| `npm test` | Full Vitest suite. No network calls. Live smoke is skipped. |
| `npm run test:live` | One real four-model run (`RUN_LIVE_TESTS=1`). Costs ~$0.08. |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npx prisma migrate dev` | Apply the SQLite schema locally |

## What you see

1. **Query** (`/`) — CRT terminal frame, glowing banner, command box, four-seat roster.
2. **Deliberation** — three streaming draft columns (you see which model holds which seat; the models do not), then critiques, then the judge spinner.
3. **Verdict** (`/run/[id]`) — synthesized answer, provenance, amber contested section (expanded by default), confidence meter, usage footer. The URL is shareable.

## Architecture

```
app/page.tsx                 query + live deliberation UI
app/run/[id]/page.tsx        shareable verdict
app/api/council/route.ts     Node SSE adapter over the orchestrator
app/api/models/route.ts      cached OpenRouter catalog proxy
council/orchestrator.ts      stage sequencing, quorum, usage
council/stages/              draft, critique, judge
council/anonymize.ts         shuffle, relabel, scrub self-references
council/providers/           Provider seam — only openrouter.ts talks HTTP
lib/db.ts                    Prisma run store (JSON blobs)
styles/theme.css             CRT phosphor tokens
```

The engine depends only on a `Provider` interface (`complete` + `stream`). Tests inject a deterministic fake. `app/api/council/route.ts` is a thin adapter: build the real provider, call `runCouncil`, forward events as SSE, persist the finished run.

The SSE route runs on the **Node runtime**, not Edge — council runs exceed Edge time limits.

## Failure policy

- Every call gets a timeout and one retry (network / 429 / 5xx, plus the stream path).
- Malformed JSON gets exactly one repair round-trip. A second failure fails that seat.
- One failed drafter **degrades** the run. The protocol continues with survivors.
- **Quorum:** two surviving drafters plus the judge. Below that the run is `failed` and the judge is never called.
- If the judge fails after retry, the run is `failed`. A drafter is never promoted to judge.
- Overclaimed `high` confidence is downgraded when more than a third of claims are single-seat.

## Deploy notes

`vercel.json` sets a 300s max duration on `/api/council` and runs `prisma generate && next build`.

What ships locally is **SQLite** via `better-sqlite3`. Vercel’s filesystem is ephemeral, so shareable `/run/[id]` links need Postgres in production:

1. Point `DATABASE_URL` at Neon (or another Postgres URL).
2. Change `provider` in `prisma/schema.prisma` from `"sqlite"` to `"postgresql"` (commented in that file).
3. Set `OPENROUTER_API_KEY` as a project secret.

Do not put secrets in the repo.

## Docs

- Design spec: [`docs/specs/2026-09-01-model-council-design.md`](docs/specs/2026-09-01-model-council-design.md)
- Implementation plan: [`docs/plans/2026-09-01-model-council.md`](docs/plans/2026-09-01-model-council.md)
