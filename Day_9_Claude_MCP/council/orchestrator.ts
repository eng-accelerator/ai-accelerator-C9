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
