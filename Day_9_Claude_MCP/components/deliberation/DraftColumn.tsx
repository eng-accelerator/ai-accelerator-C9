import { Caret } from '@/components/terminal/Caret'
import type { SeatView } from '@/lib/useCouncilStream'
import type { Seat } from '@/council/config'
import styles from './deliberation.module.css'

// Rough live estimate — the authoritative count arrives with seat_done.
const estimateTokens = (text: string) => Math.ceil(text.length / 4)

export function DraftColumn({ seat, view }: { seat: Seat; view?: SeatView }) {
  const v = view ?? { text: '', status: 'streaming' as const }
  const modelShort = seat.model.includes('/') ? seat.model.split('/')[1] : seat.model
  return (
    <article className={`${styles.column} ${v.status === 'failed' ? styles.failed : ''}`}>
      <div className={styles.head}>
        <span>
          <span className={styles.filename}>draft_{seat.id}.md</span>
          <span className={styles.seatModel}>
            {seat.label} · {modelShort}
          </span>
        </span>
        <span className={styles.meta}>
          <span className={styles.tokens}>{estimateTokens(v.text)} tok</span>
          <span className={styles.perm}>-rw-r--r--</span>
        </span>
      </div>
      {v.status === 'failed' ? (
        <p className={styles.errorText}>[!] seat failed: {v.error}</p>
      ) : (
        <p className={styles.text}>
          {v.text}
          {v.status === 'streaming' ? <Caret /> : null}
        </p>
      )}
    </article>
  )
}
