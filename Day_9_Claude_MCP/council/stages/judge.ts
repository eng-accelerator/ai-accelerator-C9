import type { CouncilConfig } from '../config'
import type { Emit } from '../events'
import type { Provider, Usage } from '../providers/types'
import { ZERO_USAGE } from '../providers/types'
import { completeJson } from '../call'
import { scrubSelfReferences } from '../anonymize'
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
    parts.push(`--- SEAT ${d.seatId} ORIGINAL DRAFT ---\n${scrubSelfReferences(d.text)}`, '')
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
    parts.push(
      `--- SEAT ${c.seatId} REVISED ANSWER ---\n${scrubSelfReferences(c.payload!.revised_answer)}`,
      '',
    )
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
