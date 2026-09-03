import { notFound } from 'next/navigation'
import { TerminalWindow } from '@/components/terminal/TerminalWindow'
import { VerdictView } from '@/components/verdict/VerdictView'
import { loadRun } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = await loadRun(id)
  if (!run) notFound()

  return (
    <TerminalWindow
      path={`~/runs/${id.slice(0, 8)}`}
      statusLabel={run.status}
      statusTone={run.status === 'failed' ? 'failed' : 'ok'}
    >
      <VerdictView run={run} />
    </TerminalWindow>
  )
}
