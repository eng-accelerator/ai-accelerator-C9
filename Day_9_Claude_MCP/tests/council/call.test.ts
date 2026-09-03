import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { callWithRetry, completeJson, SeatFailure } from '@/council/call'
import { makeFakeProvider } from '@/council/providers/fake'
import type { Provider } from '@/council/providers/types'

const Schema = z.object({ ok: z.boolean() })

function providerReturning(...texts: string[]): Provider & { calls: number } {
  let calls = 0
  const p = {
    get calls() { return calls },
    async complete() {
      const t = texts[Math.min(calls, texts.length - 1)]
      calls++
      return { text: t, usage: { promptTokens: 1, completionTokens: 1, costUsd: 0.001 }, model: 'm' }
    },
    stream() { throw new Error('not used') },
  }
  return p as unknown as Provider & { calls: number }
}

describe('callWithRetry', () => {
  it('returns on first success without retrying', async () => {
    const p = makeFakeProvider({ m: { text: 'fine' } })
    const out = await callWithRetry(p, { model: 'm', system: 's', user: 'u' }, 1000)
    expect(out.text).toBe('fine')
    expect(p.requests).toHaveLength(1)
  })

  it('retries once on failure then succeeds', async () => {
    let calls = 0
    const p: Provider = {
      async complete() {
        calls++
        if (calls === 1) throw new Error('openrouter 503')
        return { text: 'second try', usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 }, model: 'm' }
      },
      stream() { throw new Error('not used') },
    }
    const out = await callWithRetry(p, { model: 'm', system: 's', user: 'u' }, 1000)
    expect(out.text).toBe('second try')
    expect(calls).toBe(2)
  })

  it('throws SeatFailure after the retry also fails', async () => {
    const p: Provider = {
      async complete() { throw new Error('openrouter 500') },
      stream() { throw new Error('not used') },
    }
    await expect(callWithRetry(p, { model: 'm', system: 's', user: 'u' }, 1000)).rejects.toBeInstanceOf(SeatFailure)
  })

  it('times out a hanging call', async () => {
    const p: Provider = {
      complete: () => new Promise(() => {}),
      stream() { throw new Error('not used') },
    }
    await expect(callWithRetry(p, { model: 'm', system: 's', user: 'u' }, 20)).rejects.toThrow(/timed out/i)
  })

  it('aborts the in-flight complete when the timeout fires', async () => {
    let sawAbort = false
    const p: Provider = {
      complete: ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => {
            sawAbort = true
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
      stream() { throw new Error('not used') },
    }
    await expect(callWithRetry(p, { model: 'm', system: 's', user: 'u' }, 20)).rejects.toThrow(/timed out/i)
    expect(sawAbort).toBe(true)
  })
})

describe('completeJson', () => {
  it('parses valid json on the first call', async () => {
    const p = providerReturning('{"ok":true}')
    const { value } = await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(value).toEqual({ ok: true })
    expect(p.calls).toBe(1)
  })

  it('strips markdown fences before parsing', async () => {
    const p = providerReturning('```json\n{"ok":true}\n```')
    const { value } = await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(value).toEqual({ ok: true })
  })

  it('issues exactly one repair round-trip on invalid json, then succeeds', async () => {
    const p = providerReturning('{"ok":"yes"}', '{"ok":true}')
    const { value } = await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(value).toEqual({ ok: true })
    expect(p.calls).toBe(2)
  })

  it('fails the seat after a second validation failure — never a third attempt', async () => {
    const p = providerReturning('{"ok":"no"}', '{"ok":"still no"}')
    await expect(
      completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000),
    ).rejects.toBeInstanceOf(SeatFailure)
    expect(p.calls).toBe(2)
  })

  it('echoes the validation error back to the model in the repair prompt', async () => {
    const seen: string[] = []
    let calls = 0
    const p: Provider = {
      async complete(req) {
        seen.push(req.user)
        calls++
        return {
          text: calls === 1 ? '{"ok":"yes"}' : '{"ok":true}',
          usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 },
          model: 'm',
        }
      },
      stream() { throw new Error('not used') },
    }
    await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(seen[1]).toMatch(/ok/)
    expect(seen[1]).toMatch(/previous response/i)
  })

  it('accumulates usage across the repair round-trip', async () => {
    const p = providerReturning('{"ok":"yes"}', '{"ok":true}')
    const { usage } = await completeJson(p, { model: 'm', system: 's', user: 'u' }, Schema, 1000)
    expect(usage.promptTokens).toBe(2)
    expect(usage.completionTokens).toBe(2)
  })
})
