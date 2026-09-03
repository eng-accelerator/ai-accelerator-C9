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
