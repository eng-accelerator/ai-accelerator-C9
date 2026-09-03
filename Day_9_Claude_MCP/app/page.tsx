'use client'

import { useState } from 'react'
import { TerminalWindow } from '@/components/terminal/TerminalWindow'
import { QueryScreen } from '@/components/screens/QueryScreen'
import { DeliberationScreen } from '@/components/screens/DeliberationScreen'

export default function Home() {
  const [query, setQuery] = useState<string | null>(null)

  return (
    <TerminalWindow
      path="~/session"
      statusLabel={query ? 'council in session' : 'idle'}
      statusTone={query ? 'live' : 'ok'}
    >
      {query ? <DeliberationScreen query={query} /> : <QueryScreen onSubmit={setQuery} />}
    </TerminalWindow>
  )
}
