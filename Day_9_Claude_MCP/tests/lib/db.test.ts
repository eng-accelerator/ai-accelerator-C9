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
