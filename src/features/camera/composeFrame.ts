import { getFramePhotoIndexes, type BoothFrame, type FrameSlot } from './boothFrames'
import { DEFAULT_SESSION_CAMERA_SETTINGS, drawImageWithCameraEffects, type SessionCameraSettings } from './cameraEffects'

export type PhotoAdjustment = Pick<FrameSlot, 'imageZoom' | 'imageOffsetX' | 'imageOffsetY'>
export type PhotoAdjustmentMap = Record<string, PhotoAdjustment>

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gambar tidak dapat dibaca.'))
    image.src = source
  })
}

export function drawFrameComposition(
  context: CanvasRenderingContext2D,
  frame: BoothFrame,
  photoBySourceIndex: Map<number, HTMLImageElement>,
  artwork: HTMLImageElement,
  adjustments: PhotoAdjustmentMap = {},
  cameraSettings: SessionCameraSettings = DEFAULT_SESSION_CAMERA_SETTINGS,
) {
  frame.slots.forEach((slot) => {
    const photo = photoBySourceIndex.get(slot.photoIndex)
    if (!photo) return

    const adjustment = adjustments[slot.id] ?? slot
    const zoom = Math.max(1, adjustment.imageZoom || 1)
    const scale = Math.max(slot.width / photo.naturalWidth, slot.height / photo.naturalHeight) * zoom
    const imageWidth = photo.naturalWidth * scale
    const imageHeight = photo.naturalHeight * scale
    const maxPanX = Math.max(0, (imageWidth - slot.width) / 2)
    const maxPanY = Math.max(0, (imageHeight - slot.height) / 2)
    const offsetX = Math.max(-1, Math.min(1, adjustment.imageOffsetX || 0)) * maxPanX
    const offsetY = Math.max(-1, Math.min(1, adjustment.imageOffsetY || 0)) * maxPanY

    context.save()
    context.translate(slot.x + slot.width / 2, slot.y + slot.height / 2)
    context.rotate(slot.rotation * Math.PI / 180)
    context.beginPath()
    context.rect(-slot.width / 2, -slot.height / 2, slot.width, slot.height)
    context.clip()
    drawImageWithCameraEffects(context, photo, -imageWidth / 2 + offsetX, -imageHeight / 2 + offsetY, imageWidth, imageHeight, cameraSettings)
    context.restore()
  })

  // The transparent PNG is the top layer, so its artwork covers photo edges.
  context.drawImage(artwork, 0, 0, frame.width, frame.height)
}

export async function composeFrame(shots: string[], frame: BoothFrame, adjustments: PhotoAdjustmentMap = {}, cameraSettings: SessionCameraSettings = DEFAULT_SESSION_CAMERA_SETTINGS): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas tidak tersedia.')

  const photoIndexes = getFramePhotoIndexes(frame)
  const [artwork, ...photos] = await Promise.all([
    loadImage(frame.dataUrl),
    ...photoIndexes.slice(0, shots.length).map((_, index) => loadImage(shots[index])),
  ])
  const photoBySourceIndex = new Map(photoIndexes.slice(0, photos.length).map((photoIndex, index) => [photoIndex, photos[index]]))
  drawFrameComposition(context, frame, photoBySourceIndex, artwork, adjustments, cameraSettings)

  return canvas.toDataURL('image/png')
}
