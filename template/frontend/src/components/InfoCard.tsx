import type { ReactNode } from 'react'
import {LiquidGlassSurface} from '../features/learner/MobileLiquidGlassBar'

interface InfoCardProps {
  as?: 'article' | 'section'
  children: ReactNode
  headingLevel?: 2 | 3
  title: string
  mobileGlass?: boolean
  variant?: 'compact' | 'default'
}

export function InfoCard({ as = 'section', children, headingLevel = 2, title, mobileGlass = false, variant = 'default' }: InfoCardProps) {
  const className = `info-card${mobileGlass ? ' info-card--mobile-glass' : ''}${variant === 'compact' ? ' info-card--compact' : ''}`
  const heading = headingLevel === 3 ? <h3 className="info-card__title">{title}</h3> : <h2 className="info-card__title">{title}</h2>
  const glass = mobileGlass ? <LiquidGlassSurface radius={24} blur={16}/> : null
  return as === 'article' ? <article className={className}>{glass}{heading}{children}</article> : <section className={className}>{glass}{heading}{children}</section>
}

