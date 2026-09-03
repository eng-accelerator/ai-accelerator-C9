import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeFakeProvider, ZERO_USAGE, addUsage } from '@/council/providers/fake'
import { createOpenRouterProvider } from '@/council/providers/openrouter'

describe('addUsage', () => {
  it('sums token counts and cost', () => {
    const a = { promptTokens: 10, completionTokens: 5, costUsd: 0.01 }
    const b = { promptTokens: 3, completionTokens: 7, costUsd: 0.02 }
    expect(addUsage(a, b)).toEqual({ promptTokens: 13, completionTokens: 12, costUsd: 0.03 })
  })

  it('is identity over ZERO_USAGE', () => {
    const a = { promptTokens: 10, completionTokens: 5, costUsd: 0.01 }
    expect(addUsage(a, ZERO_USAGE)).toEqual(a)
  })
})

describe('makeFakeProvider', () => {
  it('returns the scripted text for a model', async () => {
    const p = makeFakeProvider({ 'model-x': { text: 'hello' } })
    const out = await p.complete({ model: 'model-x', system: 's', user: 'u' })
    expect(out.text).toBe('hello')
    expect(out.model).toBe('model-x')
  })

  it('throws the scripted error', async () => {
    const p = makeFakeProvider({ 'model-x': { error: 'boom' } })
    await expect(p.complete({ model: 'model-x', system: 's', user: 'u' })).rejects.toThrow('boom')
  })

  it('streams the scripted text in chunks and resolves done', async () => {
    const p = makeFakeProvider({ 'model-x': { text: 'abcdef', chunkSize: 2 } })
    const handle = p.stream({ model: 'model-x', system: 's', user: 'u' })
    const chunks: string[] = []
    for await (const d of handle) chunks.push(d.text)
    expect(chunks).toEqual(['ab', 'cd', 'ef'])
    expect((await handle.done).text).toBe('abcdef')
  })

  it('records the requests it received, so prompts can be asserted', async () => {
    const p = makeFakeProvider({ 'model-x': { text: 'ok' } })
    await p.complete({ model: 'model-x', system: 'SYS', user: 'USR' })
    expect(p.requests).toHaveLength(1)
    expect(p.requests[0].system).toBe('SYS')
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('createOpenRouterProvider', () => {
  it('sends the api key and the model, and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'anthropic/claude-sonnet-5',
          choices: [{ message: { content: 'the answer' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0004 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const p = createOpenRouterProvider('sk-test')
    const out = await p.complete({ model: 'anthropic/claude-sonnet-5', system: 's', user: 'u' })

    expect(out.text).toBe('the answer')
    expect(out.usage).toEqual({ promptTokens: 100, completionTokens: 50, costUsd: 0.0004 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('openrouter.ai')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
    expect(JSON.parse(init.body as string).model).toBe('anthropic/claude-sonnet-5')
  })

  it('requests json response_format when json is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: {} }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const p = createOpenRouterProvider('sk-test')
    await p.complete({ model: 'm', system: 's', user: 'u', json: true })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' })
  })

  it('throws a descriptive error on a non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })))
    const p = createOpenRouterProvider('sk-test')
    await expect(p.complete({ model: 'm', system: 's', user: 'u' })).rejects.toThrow(/429/)
  })
})
