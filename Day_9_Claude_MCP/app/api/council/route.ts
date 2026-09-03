import { NextRequest } from 'next/server'
import { runCouncil } from '@/council/orchestrator'
import { CouncilPostBodySchema, DEFAULT_CONFIG } from '@/council/config'
import { createOpenRouterProvider } from '@/council/providers/openrouter'
import { encodeEvent } from '@/lib/sse'
import { saveRun } from '@/lib/db'
import type { CouncilEvent } from '@/council/events'

// Run durations exceed Edge limits — spec section 14.
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY is not set' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const parsed = CouncilPostBodySchema.safeParse(raw)
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: 'invalid request', details: parsed.error.flatten() }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  const query = parsed.data.query
  const config = parsed.data.config ?? DEFAULT_CONFIG
  const provider = createOpenRouterProvider(apiKey)
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: CouncilEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeEvent(e)))
        } catch {
          // Client disconnected mid-run. The council keeps going and the
          // finished run is still persisted, so the share link works.
        }
      }

      try {
        const run = await runCouncil(query, config, provider, emit)
        await saveRun(run)
      } catch (e) {
        emit({ type: 'run_failed', runId: 'unknown', reason: (e as Error).message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
