'use client'

import type { CouncilConfig } from '@/council/config'
import { Panel } from '@/components/terminal/Panel'
import { SeatCard } from './SeatCard'
import styles from './roster.module.css'

export function RosterPanel({ config }: { config: CouncilConfig }) {
  const labs = [...config.drafters.map((s) => s.lab), config.judge.lab]
  const judgeShares = labs.filter((l) => l === config.judge.lab).length > 1

  return (
    <Panel>
      <div className={styles.grid}>
        {config.drafters.map((seat) => (
          <SeatCard key={seat.id} seat={seat} role="drafter" />
        ))}
        <SeatCard seat={config.judge} role="judge" />
      </div>
      {judgeShares ? (
        <p className={styles.warning}>
          The judge shares a lab with a drafter. Blind labels reduce self-preference bias but do not
          eliminate it.
        </p>
      ) : null}
    </Panel>
  )
}
