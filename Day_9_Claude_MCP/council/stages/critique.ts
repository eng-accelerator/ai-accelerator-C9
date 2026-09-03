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
