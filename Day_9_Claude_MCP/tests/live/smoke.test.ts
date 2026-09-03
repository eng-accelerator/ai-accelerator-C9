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
