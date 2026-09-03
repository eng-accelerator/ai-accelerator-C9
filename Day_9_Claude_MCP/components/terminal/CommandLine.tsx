import styles from './terminal.module.css'

export function CommandLine({ command }: { command: string }) {
  return (
    <div className={styles.command}>
      <span className={styles.prompt}>council~/session $ </span>
      <span className={styles.cmd}>{command}</span>
    </div>
  )
}

export function Rule() {
  return <hr className={styles.rule} />
}
