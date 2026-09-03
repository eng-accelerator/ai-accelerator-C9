import type { Verdict } from '@/council/schemas'
import styles from './verdict.module.css'

// Expanded by default. This is the reason the product exists — spec 11.4.
export function ContestedSection({ contested }: { contested: Verdict['contested'] }) {
  if (contested.length === 0) {
    return <p className={styles.unanimous}>[x] no contested points. the council agreed.</p>
  }

  return (
    <section className={styles.contested}>
      <div className={styles.contestedTitle}>
        CONTESTED ({contested.length}) // where the council disagreed
      </div>
      {contested.map((c, i) => (
        <div key={i} className={styles.contestedItem}>
          <div className={styles.point}>{c.point}</div>
          {c.positions.map((p, j) => (
            <div key={j} className={styles.position}>
              seat {p.seat}: {p.position}
            </div>
          ))}
          <div className={styles.ruling}>
            {c.ruling} — {c.reasoning}
          </div>
        </div>
      ))}
    </section>
  )
}
