import type { CompleteRequest, Completion, Delta, Provider, StreamHandle, Usage } from './types'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'Model Council',
  }
}

function body(req: CompleteRequest, stream: boolean): string {
  return JSON.stringify({
    model: req.model,
    stream,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  })
}

function parseUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, number>
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    costUsd: u.cost ?? 0,
  }
}

export function createOpenRouterProvider(apiKey: string): Provider {
  return {
    async complete(req: CompleteRequest): Promise<Completion> {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: headers(apiKey),
        body: body(req, false),
        signal: req.signal,
      })
      if (!res.ok) {
        throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
      }
      const data = (await res.json()) as {
        model?: string
        choices?: Array<{ message?: { content?: string } }>
        usage?: unknown
      }
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        usage: parseUsage(data.usage),
        model: data.model ?? req.model,
      }
    },

    stream(req: CompleteRequest): StreamHandle {
      let settle: (c: Completion) => void = () => {}
      let fail: (e: unknown) => void = () => {}
      const done = new Promise<Completion>((res, rej) => {
        settle = res
        fail = rej
      })

      async function* gen(): AsyncGenerator<Delta> {
        try {
          const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: headers(apiKey),
            body: body(req, true),
            signal: req.signal,
          })
          if (!res.ok || !res.body) {
            throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let text = ''
          let usage: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 }

          while (true) {
            const { done: finished, value } = await reader.read()
            if (finished) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue
              const payload = trimmed.slice(5).trim()
              if (payload === '[DONE]') continue
              let evt: {
                choices?: Array<{ delta?: { content?: string } }>
                usage?: unknown
              }
              try {
                evt = JSON.parse(payload)
              } catch {
                continue // OpenRouter emits periodic comment lines
              }
              const piece = evt.choices?.[0]?.delta?.content
              if (piece) {
                text += piece
                yield { text: piece }
              }
              if (evt.usage) usage = parseUsage(evt.usage)
            }
          }

          settle({ text, usage, model: req.model })
        } catch (e) {
          fail(e)
          throw e
        }
      }

      const handle = gen() as unknown as StreamHandle
      Object.defineProperty(handle, 'done', { value: done })
      void done.catch(() => {})
      return handle
    },
  }
}
