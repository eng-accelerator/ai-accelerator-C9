import type { CouncilEvent } from '@/council/events'

// JSON.stringify already escapes newlines, so a single-line data frame is
// always safe. The blank line terminates the frame.
export function encodeEvent(e: CouncilEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`
}

export function parseEventStream(chunk: string): CouncilEvent[] {
  const out: CouncilEvent[] = []
  for (const frame of chunk.split('\n\n')) {
    const line = frame.trim()
    if (!line.startsWith('data:')) continue
    try {
      out.push(JSON.parse(line.slice(5).trim()) as CouncilEvent)
    } catch {
      // Trailing partial frame — the next chunk completes it.
    }
  }
  return out
}
