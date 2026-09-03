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

async function streamDraft(
  seat: Seat,
  query: string,
  timeoutMs: number,
  provider: Provider,
  emit: Emit,
): Promise<{ text: string; usage: Usage }> {
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
    return { text: text || completion.text, usage: completion.usage }
  } finally {
    clearTimeout(timer)
  }
}

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

  // Spec §10: every call gets one retry — streams included.
  try {
    try {
      const result = await streamDraft(seat, query, timeoutMs, provider, emit)
      emit({ type: 'seat_done', seat: seat.id, usage: result.usage })
      return { ...base, text: result.text, usage: result.usage }
    } catch {
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 500))
      const result = await streamDraft(seat, query, timeoutMs, provider, emit)
      emit({ type: 'seat_done', seat: seat.id, usage: result.usage })
      return { ...base, text: result.text, usage: result.usage }
    }
  } catch (e) {
    const reason = (e as Error).message
    emit({ type: 'seat_failed', seat: seat.id, reason })
    return { ...base, status: 'failed', error: reason }
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
