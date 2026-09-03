import styles from './terminal.module.css'

const TONES = {
  live: 'var(--amber)',
  ok: 'var(--phosphor)',
  failed: 'var(--danger)',
} as const

export function StatusDot({ tone }: { tone: keyof typeof TONES }) {
  return <span className={styles.statusDot} style={{ background: TONES[tone] }} aria-hidden="true" />
}
