export type DrawerTarget = 'closed' | 'open'

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback

export function clampDrawerY(value: number, travel: number) {
  const safeTravel = Math.max(0, finite(travel, 0))
  return Math.min(safeTravel, Math.max(0, finite(value, safeTravel)))
}

export function drawerProgress(y: number, travel: number) {
  const safeTravel = Math.max(0, finite(travel, 0))
  return safeTravel === 0 ? 0 : 1 - clampDrawerY(y, safeTravel) / safeTravel
}

export function rubberBand(distance: number, dimension: number, constant = 0.18) {
  const safeDistance = Math.max(0, finite(distance, 0))
  const safeDimension = Math.max(1, finite(dimension, 1))
  return (safeDistance * safeDimension * constant) / (safeDimension + constant * safeDistance)
}

export function releaseTarget({ progress, velocityY }: { progress: number, velocityY: number }): DrawerTarget {
  const safeProgress = finite(progress, 0)
  const safeVelocity = finite(velocityY, 0)
  if (safeVelocity <= -0.45) return 'open'
  if (safeVelocity >= 0.45) return 'closed'
  return safeProgress >= 0.5 ? 'open' : 'closed'
}

