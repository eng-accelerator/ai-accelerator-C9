import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '@/lib/markdown'

describe('renderMarkdown', () => {
  it('renders headings', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>')
    expect(renderMarkdown('## Sub')).toContain('<h2>Sub</h2>')
  })

  it('renders bold and inline code', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>')
    expect(renderMarkdown('`code`')).toContain('<code>code</code>')
  })

  it('renders unordered lists', () => {
    const out = renderMarkdown('- one\n- two')
    expect(out).toContain('<li>one</li>')
    expect(out).toContain('<li>two</li>')
  })

  it('escapes raw html so model output cannot inject script', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes html inside a code span', () => {
    expect(renderMarkdown('`<img onerror=x>`')).not.toContain('<img')
  })

  it('escapes an attribute-injection attempt in a heading', () => {
    expect(renderMarkdown('# <a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
  })

  it('leaves plain paragraphs intact', () => {
    expect(renderMarkdown('just words')).toContain('<p>just words</p>')
  })
})
