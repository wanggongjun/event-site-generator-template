import type { ReactNode } from 'react'

export function ContentSection({ children, id, title, titleNote }: { children: ReactNode; id?: string; title: string; titleNote?: string }) {
  return <section className="content-section" id={id}><h2 className="content-section__title">{title}{titleNote ? <small className="content-section__title-note">{titleNote}</small> : null}</h2><div className="content-section__body">{children}</div></section>
}

