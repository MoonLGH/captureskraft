import type { BoothFrame } from './boothFrames'

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gambar frame tidak dapat dibaca.'))
    image.src = source
  })
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  const sourceX = (image.naturalWidth - sourceWidth) / 2
  const sourceY = (image.naturalHeight - sourceHeight) / 2
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

export async function composeFrame(shots: string[], frame: BoothFrame): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas tidak tersedia.')

  const photos = await Promise.all(shots.slice(0, frame.slots.length).map(loadImage))
  photos.forEach((photo, index) => {
    const slot = frame.slots[index]
    context.save()
    context.translate(slot.x + slot.width / 2, slot.y + slot.height / 2)
    context.rotate((slot.rotation ?? 0) * Math.PI / 180)
    drawCover(context, photo, -slot.width / 2, -slot.height / 2, slot.width, slot.height)
    context.restore()
  })

  const artwork = await loadImage(frame.dataUrl)
  context.drawImage(artwork, 0, 0, canvas.width, canvas.height)

  return canvas.toDataURL('image/png')
}
