import { CalendarDays, MapPin } from 'lucide-react'

export interface EventBannerImage {
  src: string
  webpSrc?: string
  width: number
  height: number
}

export interface EventBannerProps {
  title: string
  titleHref?: string
  dates: string
  venue: string
  tagline?: string
  scale?: string
  image?: EventBannerImage
  backgroundImage?: string
  institutions?: string[]
  seriesText?: string
  brandmarks?: {label: string; asset: string}[]
}

export function EventBanner({ title, titleHref, dates, venue, tagline, scale, image, backgroundImage, institutions, seriesText, brandmarks }: EventBannerProps) {
  if (image) {
    const responsiveImage = <img
      alt=""
      className="event-banner__image"
      decoding="async"
      fetchPriority="high"
      height={image.height}
      src={image.src}
      width={image.width}
    />
    const imageContent = <>
      {image.webpSrc
        ? <picture className="event-banner__image-picture"><source srcSet={image.webpSrc} type="image/webp" />{responsiveImage}</picture>
        : responsiveImage}
      <span className="event-banner__accessible-title">{title}</span>
    </>
    return <header className="event-banner event-banner--image" data-testid="event-banner">
      <h1 className="event-banner__image-title">
        {titleHref ? <a className="event-banner__image-link" href={titleHref}>{imageContent}</a> : imageContent}
      </h1>
    </header>
  }

  const titleContent = title
  return <header className={`event-banner${backgroundImage ? ' event-banner--background' : ''}`} style={backgroundImage ? {backgroundImage: `url("${backgroundImage}")`} : undefined} data-testid="event-banner">
    <div className="event-container">
      <div className="event-banner__topline">{brandmarks?.length ? <div className="event-banner__brandmarks">{brandmarks.map(mark=><img key={mark.asset} src={mark.asset} alt={mark.label}/>)}</div> : !!institutions?.length && <div className="event-banner__institutions">{institutions.map(name => <span key={name}>{name}</span>)}</div>}{seriesText&&<p className="event-banner__series">{seriesText}</p>}</div>
      <h1 className="event-banner__title">{titleHref ? <a href={titleHref}>{titleContent}</a> : titleContent}</h1>
      {tagline ? <p className="event-banner__tagline">{tagline}</p> : null}
      {(dates||venue||scale)&&<div className="event-banner__meta" aria-label="活动信息">
        {dates&&<span><CalendarDays aria-hidden="true" size={14} />{dates}</span>}
        {venue&&<span><MapPin aria-hidden="true" size={14} />{venue}</span>}
        {scale ? <span>{scale}</span> : null}
      </div>}
    </div>
  </header>
}

