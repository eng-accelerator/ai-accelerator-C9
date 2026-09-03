'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
      // Keep runId/usage here; status becomes 'done' only when the SSE reader
      // finishes so saveRun on the server has completed before navigation.
      return { ...state, runId: e.runId, usage: e.usage }
    case 'run_failed':
      return { ...state, status: 'failed', error: e.reason }
    default:
      return state
  }
}

type SetStreamState = (update: StreamState | ((prev: StreamState) => StreamState)) => void

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message))
}

/** Exported for focused fetch/stream failure tests without a React harness. */
export async function startCouncilStream(
  query: string,
  config: CouncilConfig,
  setState: SetStreamState,
  signal?: AbortSignal,
): Promise<void> {
  setState({ ...INITIAL_STATE, status: 'running' })

  try {
    const res = await fetch('/api/council', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, config }),
      signal,
    })

    if (!res.ok || !res.body) {
      const detail = await res.text()
      setState((s) => ({ ...s, status: 'failed', error: detail.slice(0, 300) }))
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const onAbort = () => {
      void reader.cancel()
    }
    signal?.addEventListener('abort', onAbort)
    if (signal?.aborted) onAbort()

    try {
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

      if (buffer.trim()) {
        for (const e of parseEventStream(buffer)) {
          setState((s) => reduceEvent(s, e))
        }
      }

      // Aborted mid-stream: reader may close cleanly — do not mark done.
      if (signal?.aborted) return

      // Reader closed after saveRun — safe to mark done / navigate.
      setState((s) => {
        if (s.status !== 'running') return s
        return { ...s, status: 'done' }
      })
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) return
    const reason = err instanceof Error ? err.message : 'network error'
    setState((s) => ({ ...s, status: 'failed', error: reason.slice(0, 300) }))
  }
}

export function useCouncilStream() {
  const [state, setState] = useState<StreamState>(INITIAL_STATE)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const start = useCallback(async (query: string, config: CouncilConfig) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    await startCouncilStream(query, config, setState, ac.signal)
  }, [])

  // Abort in-flight fetch/reader if the hook unmounts (Strict Mode remount).
  useEffect(() => () => cancel(), [cancel])

  return { state, start, cancel }
}
