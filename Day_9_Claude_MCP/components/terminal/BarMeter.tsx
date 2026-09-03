import styles from './terminal.module.css'

export function BarMeter({
  label,
  value,
  max = 100,
  display,
}: {
  label: string
  value: number
  max?: number
  display?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={styles.meterRow}>
      <span className={styles.meterLabel}>{label}</span>
      <span className={styles.meterTrack}>
        <span className={styles.meterFill} style={{ width: `${pct}%` }} />
      </span>
      <span className={styles.meterValue}>{display ?? Math.round(pct)}</span>
    </div>
  )
}
