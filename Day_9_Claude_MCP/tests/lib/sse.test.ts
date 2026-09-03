import { describe, it, expect } from 'vitest'
import { encodeEvent, parseEventStream } from '@/lib/sse'
import type { CouncilEvent } from '@/council/events'

describe('sse encoding', () => {
  it('encodes an event as a data line terminated by a blank line', () => {
    const e: CouncilEvent = { type: 'token', seat: 1, text: 'hi' }
    expect(encodeEvent(e)).toBe(`data: ${JSON.stringify(e)}\n\n`)
  })

  it('escapes newlines in token text so the frame is not split', () => {
    const e: CouncilEvent = { type: 'token', seat: 1, text: 'line one\nline two' }
    const encoded = encodeEvent(e)
    expect(encoded.split('\n\n')).toHaveLength(2)
    expect(parseEventStream(encoded)[0]).toEqual(e)
  })

  it('round-trips a batch of events in order', () => {
    const events: CouncilEvent[] = [
      { type: 'stage_started', stage: 'draft' },
      { type: 'token', seat: 1, text: 'a' },
      { type: 'stage_done', stage: 'draft' },
    ]
    const stream = events.map(encodeEvent).join('')
    expect(parseEventStream(stream)).toEqual(events)
  })

  it('ignores a trailing partial frame', () => {
    const stream = `${encodeEvent({ type: 'stage_done', stage: 'judge' })}data: {"type":"toke`
    expect(parseEventStream(stream)).toHaveLength(1)
  })
})
