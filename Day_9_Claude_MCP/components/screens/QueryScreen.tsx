'use client'

import { useState } from 'react'
import { CommandLine, Rule } from '@/components/terminal/CommandLine'
import { Caret } from '@/components/terminal/Caret'
import { RosterPanel } from '@/components/roster/RosterPanel'
import { DEFAULT_CONFIG } from '@/council/config'

export function QueryScreen({ onSubmit }: { onSubmit: (query: string) => void }) {
  const [query, setQuery] = useState('')

  return (
    <>
      <CommandLine command="council --version" />

      <h1 className="nameBanner">
        MODEL COUNCIL<span style={{ color: 'var(--phosphor)' }}>_</span>
      </h1>
      <p className="roleLine">four models. one verdict.</p>
      <p className="intro">
        One question, answered independently by three models from three labs, then{' '}
        <span className="hl">critiqued blind</span> by each other and revised. A fourth model that
        wrote no draft synthesizes the result and reports{' '}
        <span className="hl">where they disagreed</span>.
      </p>

      <div className="metaChecks">
        <span>4 seats, 4 labs</span>
        <span>~$0.08 per run</span>
        <span>~40s end to end</span>
      </div>

      <CommandLine command="council ask" />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (query.trim()) onSubmit(query.trim())
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            background: '#000',
            border: '1px solid var(--hairline-bright)',
            borderRadius: 6,
            padding: '14px 16px',
            boxShadow: '0 0 20px rgba(57,255,122,0.07)',
          }}
        >
          <span style={{ color: 'var(--phosphor)', textShadow: 'var(--glow-soft)' }}>$</span>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
            }}
            rows={3}
            placeholder="ask the council something hard"
            style={{
              flex: 1,
              background: 'transparent',
              border: 0,
              outline: 'none',
              resize: 'vertical',
              color: 'var(--ink)',
              font: 'inherit',
            }}
          />
          {query ? null : <Caret />}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button
            type="submit"
            disabled={!query.trim()}
            style={{
              background: 'var(--phosphor)',
              color: '#00140a',
              border: 0,
              borderRadius: 6,
              padding: '10px 18px',
              font: 'inherit',
              fontWeight: 700,
              cursor: query.trim() ? 'pointer' : 'not-allowed',
              opacity: query.trim() ? 1 : 0.4,
              boxShadow: '0 0 18px rgba(57,255,122,0.35)',
            }}
          >
            $ council convene {'->'}
          </button>
          <span style={{ color: 'var(--phosphor-faint)', alignSelf: 'center', fontSize: 12 }}>
            cmd+enter
          </span>
        </div>
      </form>

      <Rule />
      <div id="roster">
        <CommandLine command="neofetch --seats" />
        <RosterPanel config={DEFAULT_CONFIG} />
      </div>
    </>
  )
}
