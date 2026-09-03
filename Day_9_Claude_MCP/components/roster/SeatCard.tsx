import type { Seat } from '@/council/config'
import styles from './roster.module.css'

const AVATAR = ['  ▄▄▄▄▄  ', ' █ ▀ ▀ █ ', ' █  ▄  █ ', ' ▀█▄▄▄█▀ ', '  ▐███▌  '].join('\n')

const SWATCHES = ['#1c7a3c', '#2bbf5c', '#39ff7a', '#5f8d68', '#eafff1', '#ffd24a', '#ff5f56', '#070b07']

export function SeatCard({ seat, role }: { seat: Seat; role: 'drafter' | 'judge' }) {
  return (
    <article className={`${styles.card} ${role === 'judge' ? styles.judge : ''}`}>
      <div>
        <pre className={styles.avatar}>{AVATAR}</pre>
        <div className={styles.avatarLabel}>{role === 'judge' ? 'judge@bench' : `seat${seat.id}@dev`}</div>
      </div>
      <div>
        <div className={styles.kvTitle}>
          {seat.label.toLowerCase().replace(' ', '')}@council {'-'.repeat(10)}
        </div>
        <dl className={styles.kv}>
          <dt className={styles.k}>Model</dt>
          <dd className={styles.v}>{seat.model.split('/')[1]}</dd>
          <dt className={styles.k}>Lab</dt>
          <dd className={styles.v}>{seat.lab}</dd>
          <dt className={styles.k}>Role</dt>
          <dd className={styles.v}>{role === 'judge' ? 'Synthesis, no draft' : 'Draft, critique, revise'}</dd>
          <dt className={styles.k}>Status</dt>
          <dd className={styles.available}>available</dd>
        </dl>
        <div className={styles.swatches}>
          {SWATCHES.map((c) => (
            <span key={c} className={styles.swatch} style={{ background: c }} />
          ))}
        </div>
      </div>
    </article>
  )
}
