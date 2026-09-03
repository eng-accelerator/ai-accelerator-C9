import type { Verdict } from '@/council/schemas'
import styles from './verdict.module.css'

export function ProvenanceList({ provenance }: { provenance: Verdict['provenance'] }) {
  if (provenance.length === 0) return null
  return (
    <div className={styles.provenance}>
      {provenance.map((p, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <span className={styles.claim}>{p.claim}</span>
          <span className={p.support === 'single' ? styles.supportSingle : styles.support}>
            {p.support}
          </span>
          <span className={styles.seats}>seats {p.seats.join(',') || '-'}</span>
        </div>
      ))}
    </div>
  )
}
