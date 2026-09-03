import styles from './terminal.module.css'
import { StatusDot } from './StatusDot'

export function TerminalWindow({
  path = '~/session',
  statusLabel = 'idle',
  statusTone = 'ok',
  children,
}: {
  path?: string
  statusLabel?: string
  statusTone?: 'live' | 'ok' | 'failed'
  children: React.ReactNode
}) {
  return (
    <div className={styles.window}>
      <div className={styles.titlebar}>
        <div className={styles.dots}>
          <span className={styles.dot} style={{ background: 'var(--dot-red)' }} />
          <span className={styles.dot} style={{ background: 'var(--dot-amber)' }} />
          <span className={styles.dot} style={{ background: 'var(--dot-green)' }} />
        </div>
        <span className={styles.path}>
          <span className={styles.pathUser}>council</span>@openrouter: {path}
        </span>
        <nav className={styles.nav}>
          <a className={styles.navLink} href="/">~/ask</a>
          <a className={styles.navLink} href="/#roster">~/roster</a>
          <span className={styles.status}>
            <StatusDot tone={statusTone} />
            {statusLabel}
          </span>
        </nav>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  )
}
