import type { CritiqueOutput } from '@/council/schemas'
import styles from './deliberation.module.css'

export function CritiqueList({ critiques }: { critiques: Record<number, CritiqueOutput> }) {
  const entries = Object.entries(critiques)
  if (entries.length === 0) return null

  return (
    <div className={styles.columns}>
      {entries.map(([seatId, payload]) => (
        <article key={seatId} className={styles.column}>
          <div className={styles.head}>
            <span className={styles.filename}>critique_{seatId}.json</span>
          </div>
          <ul className={styles.findings}>
            {payload.critiques.flatMap((peer, i) => [
              ...peer.gaps.map((g, j) => (
                <li key={`g${i}-${j}`} className={styles.gap}>
                  {g}
                </li>
              )),
              ...peer.factual_errors.map((f, j) => (
                <li key={`f${i}-${j}`} className={styles.err}>
                  {f}
                </li>
              )),
            ])}
          </ul>
        </article>
      ))}
    </div>
  )
}
