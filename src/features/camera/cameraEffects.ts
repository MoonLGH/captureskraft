export type PhotoFilter = 'natural' | 'warm' | 'cool' | 'monochrome' | 'sepia' | 'vintage'

export type SessionCameraSettings = {
  filter: PhotoFilter
  smoothSkin: boolean
  retouch: boolean
}

export const DEFAULT_SESSION_CAMERA_SETTINGS: SessionCameraSettings = {
  filter: 'natural',
  smoothSkin: false,
  retouch: false,
}

export const PHOTO_FILTERS: { id: PhotoFilter; name: string; description: string; css: string; swatch: string }[] = [
  { id: 'natural', name: 'Natural', description: 'Warna asli yang cerah', css: 'none', swatch: 'linear-gradient(135deg, #f3c7ac, #df7890 48%, #7e9cbe)' },
  { id: 'warm', name: 'Warm', description: 'Hangat dan lembut', css: 'sepia(.12) saturate(1.12) brightness(1.03)', swatch: 'linear-gradient(135deg, #f5d6a6, #e8976e 48%, #a96a53)' },
  { id: 'cool', name: 'Cool', description: 'Nuansa sejuk dan bersih', css: 'saturate(.92) hue-rotate(7deg) brightness(1.03)', swatch: 'linear-gradient(135deg, #d4e7f5, #9cb8dc 48%, #667baf)' },
  { id: 'monochrome', name: 'Monochrome', description: 'Hitam putih klasik', css: 'grayscale(1) contrast(1.06)', swatch: 'linear-gradient(135deg, #f1eeee, #a8a3a6 48%, #414047)' },
  { id: 'sepia', name: 'Sepia', description: 'Warna film nostalgia', css: 'sepia(.58) saturate(.82) contrast(1.02)', swatch: 'linear-gradient(135deg, #e8d5b1, #b8865d 48%, #624b3d)' },
  { id: 'vintage', name: 'Vintage', description: 'Pudar lembut ala analog', css: 'sepia(.2) saturate(.78) contrast(.91) brightness(1.05)', swatch: 'linear-gradient(135deg, #e4d6ba, #bd9d8b 48%, #718176)' },
]

export function cameraFilterCss(settings: SessionCameraSettings): string {
  return PHOTO_FILTERS.find((filter) => filter.id === settings.filter)?.css ?? 'none'
}

function combineFilterCss(settings: SessionCameraSettings, ...extraFilters: string[]): string {
  return [cameraFilterCss(settings), ...extraFilters].filter((filter) => filter && filter !== 'none').join(' ') || 'none'
}

export function cameraPreviewCss(settings: SessionCameraSettings): string {
  return combineFilterCss(settings,
    settings.smoothSkin ? 'blur(.15px)' : '',
    settings.retouch ? 'brightness(1.03) contrast(1.01)' : '',
  )
}

export function drawImageWithCameraEffects(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  settings: SessionCameraSettings,
) {
  context.save()
  context.filter = cameraFilterCss(settings)
  context.drawImage(image, x, y, width, height)
  context.restore()

  if (settings.smoothSkin) {
    context.save()
    context.globalAlpha = 0.13
    context.filter = combineFilterCss(settings, 'blur(1.5px)')
    context.drawImage(image, x, y, width, height)
    context.restore()
  }
  if (settings.retouch) {
    context.save()
    context.globalAlpha = 0.08
    context.filter = combineFilterCss(settings, 'brightness(1.08)', 'contrast(1.02)', 'blur(.35px)')
    context.drawImage(image, x, y, width, height)
    context.restore()
  }
}
