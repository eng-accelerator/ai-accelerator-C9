function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A deliberately tiny markdown subset. Everything is escaped first, so no
 * model-generated string can inject markup. Adding a full markdown library
 * here would widen the attack surface for very little gain.
 */
export function renderMarkdown(md: string): string {
  // Neutralize javascript: so escaped attribute-injection attempts cannot
  // retain an executable-looking URI substring in the output.
  const lines = escapeHtml(md).replace(/javascript:/gi, 'javascript&#58;').split('\n')
  const out: string[] = []
  let inList = false

  const inline = (s: string) =>
    s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  for (const raw of lines) {
    const line = raw.trimEnd()

    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }
    if (inList) { out.push('</ul>'); inList = false }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (line.trim() === '') continue
    out.push(`<p>${inline(line)}</p>`)
  }

  if (inList) out.push('</ul>')
  return out.join('\n')
}
