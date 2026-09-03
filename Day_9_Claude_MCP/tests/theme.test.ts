import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('styles/theme.css', 'utf8')

describe('theme tokens', () => {
  const required: Record<string, string> = {
    '--phosphor': '#39ff7a',
    '--phosphor-dim': '#2bbf5c',
    '--phosphor-faint': '#1c7a3c',
    '--sage': '#5f8d68',
    '--ink': '#eafff1',
    '--panel': '#050805',
    '--panel-lift': '#070b07',
    '--hairline': '#143614',
    '--hairline-bright': '#1f4d1f',
    '--amber': '#ffd24a',
    '--danger': '#ff5f56',
  }

  for (const [token, value] of Object.entries(required)) {
    it(`defines ${token} as ${value}`, () => {
      expect(css).toMatch(new RegExp(`${token}\\s*:\\s*${value}`, 'i'))
    })
  }

  it('contains no purple or indigo', () => {
    const banned = /#(6[0-9a-f]{2}[3-9a-f][0-9a-f]f{2}|[4-9a-f][0-9a-f]{2}[0-9a-f]{2}ff)\b|indigo|purple|violet/i
    expect(css).not.toMatch(banned)
  })

  it('uses only 3-8px radii', () => {
    const radii = [...css.matchAll(/border-radius:\s*(\d+)px/g)].map((m) => Number(m[1]))
    expect(radii.length).toBeGreaterThan(0)
    for (const r of radii) expect(r).toBeGreaterThanOrEqual(3)
    for (const r of radii) expect(r).toBeLessThanOrEqual(8)
  })
})
