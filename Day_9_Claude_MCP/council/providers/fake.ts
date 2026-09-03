import type { CompleteRequest, Completion, Delta, Provider, StreamHandle } from './types'
import { ZERO_USAGE } from './types'

export { ZERO_USAGE, addUsage } from './types'

export type FakeEntry = {
  text?: string
  error?: string
  chunkSize?: number
  delayMs?: number
  /** Return a different response on the nth call — used for repair tests. */
  thenText?: string
}

export type FakeScript = Record<string, FakeEntry>
export type FakeProvider = Provider & { requests: CompleteRequest[] }

const USAGE = { promptTokens: 100, completionTokens: 50, costUsd: 0.0004 }

export function makeFakeProvider(script: FakeScript): FakeProvider {
  const requests: CompleteRequest[] = []
  const callCounts = new Map<string, number>()

  function resolve(req: CompleteRequest): string {
    const entry = script[req.model]
    if (!entry) throw new Error(`fake provider has no script for model ${req.model}`)
    const n = (callCounts.get(req.model) ?? 0) + 1
    callCounts.set(req.model, n)
    if (entry.error) throw new Error(entry.error)
    if (n > 1 && entry.thenText !== undefined) return entry.thenText
    return entry.text ?? ''
  }

  return {
    requests,
    async complete(req: CompleteRequest): Promise<Completion> {
      requests.push(req)
      const entry = script[req.model]
      if (entry?.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs))
      const text = resolve(req)
      return { text, usage: { ...USAGE }, model: req.model }
    },
    stream(req: CompleteRequest): StreamHandle {
      requests.push(req)
      const entry = script[req.model]
      let settle: (c: Completion) => void = () => {}
      let fail: (e: unknown) => void = () => {}
      const done = new Promise<Completion>((res, rej) => {
        settle = res
        fail = rej
      })

      async function* gen(): AsyncGenerator<Delta> {
        try {
          if (entry?.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs))
          const text = resolve(req)
          const size = entry?.chunkSize ?? (text.length || 1)
          for (let i = 0; i < text.length; i += size) {
            yield { text: text.slice(i, i + size) }
          }
          settle({ text, usage: { ...USAGE }, model: req.model })
        } catch (e) {
          fail(e)
          throw e
        }
      }

      const handle = gen() as unknown as StreamHandle
      Object.defineProperty(handle, 'done', { value: done })
      // Prevent an unhandled rejection when a caller never awaits done.
      void done.catch(() => {})
      return handle
    },
  }
}
