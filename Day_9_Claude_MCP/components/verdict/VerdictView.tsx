import type { RunRecord } from '@/council/orchestrator'
import { CommandLine, Rule } from '@/components/terminal/CommandLine'
import { BarMeter } from '@/components/terminal/BarMeter'
import { renderMarkdown } from '@/lib/markdown'
import { ProvenanceList } from './ProvenanceList'
import { ContestedSection } from './ContestedSection'
import styles from './verdict.module.css'

const CONFIDENCE_VALUE = { high: 90, medium: 60, low: 30 } as const

export function VerdictView({ run }: { run: RunRecord }) {
  const failedSeats = run.stages.drafts.filter((d) => d.status === 'failed')
  const calls = run.stages.drafts.length + run.stages.critiques.length + 1
  const totalTokens = run.usage.promptTokens + run.usage.completionTokens

  if (!run.verdict) {
    return (
      <>
        <CommandLine command={`council show ${run.id}`} />
        <p className={styles.degraded}>run failed: {run.error ?? 'unknown error'}</p>
      </>
    )
  }

  return (
    <>
      <CommandLine command={`council show ${run.id}`} />
      <p style={{ color: 'var(--phosphor-faint)', fontSize: 12 }}>{run.query}</p>

      {run.status === 'degraded' ? (
        <p className={styles.degraded}>
          degraded run: {failedSeats.length} seat(s) failed —{' '}
          {failedSeats.map((s) => `seat ${s.seatId}`).join(', ')}. the verdict was synthesized from
          the survivors.
        </p>
      ) : null}

      <Rule />
      <CommandLine command="cat verdict.md" />
      <div
        className={styles.answer}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(run.verdict.answer_markdown) }}
      />

      <Rule />
      <CommandLine command="council provenance --by-claim" />
      <ProvenanceList provenance={run.verdict.provenance} />

      <Rule />
      <CommandLine command="council contested --expand" />
      <ContestedSection contested={run.verdict.contested} />

      <Rule />
      <CommandLine command="council confidence" />
      <BarMeter
        label="confidence"
        value={CONFIDENCE_VALUE[run.verdict.confidence]}
        display={run.verdict.confidence}
      />
      {run.confidenceAdjusted ? (
        <p style={{ color: 'var(--amber)', fontSize: 12, marginTop: 8 }}>
          [!] the judge claimed high confidence, but too many claims rest on a single seat. adjusted
          down.
        </p>
      ) : null}

      <div className={styles.footer}>
        <span>
          $ echo &quot;model council // {run.status}&quot;
        </span>
        <span>
          {run.stages.drafts.length + 1} seats, {calls} calls, {(totalTokens / 1000).toFixed(1)}k tok,
          ${run.usage.costUsd.toFixed(3)}, {(run.elapsedMs / 1000).toFixed(0)}s
        </span>
      </div>
    </>
  )
}
