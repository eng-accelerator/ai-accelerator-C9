import styles from './terminal.module.css'

export function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className={styles.panel}>
      {title ? <div className={styles.panelTitle}>{title}</div> : null}
      {children}
    </section>
  )
}
