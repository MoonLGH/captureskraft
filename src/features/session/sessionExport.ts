import GIF from 'gif.js'
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url'
import { composeFrame, type PhotoAdjustmentMap } from '../camera/composeFrame'
import type { BoothFrame } from '../camera/boothFrames'

export type SessionExportFile = { name: string; bytes: Uint8Array }

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Foto sesi tidak dapat dibaca.'))
    image.src = source
  })
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('PNG sesi tidak dapat dibuat.'))
        return
      }
      resolve(new Uint8Array(await blob.arrayBuffer()))
    }, 'image/png')
  })
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function pngBytesForShot(source: string): Promise<Uint8Array> {
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas tidak tersedia untuk menyimpan foto.')
  context.drawImage(image, 0, 0)
  return canvasToPngBytes(canvas)
}

async function composeUnframedPhotos(shots: string[]): Promise<Uint8Array> {
  const photos = await Promise.all(shots.map(loadImage))
  const canvas = document.createElement('canvas')
  const panelWidth = 640
  const panelHeight = 480
  canvas.width = panelWidth
  canvas.height = panelHeight * photos.length
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas tidak tersedia untuk menyusun hasil sesi.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  photos.forEach((photo, index) => {
    const scale = Math.min(panelWidth / photo.naturalWidth, panelHeight / photo.naturalHeight)
    const width = photo.naturalWidth * scale
    const height = photo.naturalHeight * scale
    context.drawImage(photo, (panelWidth - width) / 2, index * panelHeight + (panelHeight - height) / 2, width, height)
  })
  return canvasToPngBytes(canvas)
}

async function createBoomerangGif(shots: string[]): Promise<Uint8Array> {
  const photos = await Promise.all(shots.map(loadImage))
  const maxDimension = 480
  const scale = Math.min(1, maxDimension / Math.max(photos[0].naturalWidth, photos[0].naturalHeight))
  const width = Math.max(1, Math.round(photos[0].naturalWidth * scale))
  const height = Math.max(1, Math.round(photos[0].naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas tidak tersedia untuk membuat GIF.')

  const gif = new GIF({
    workers: 2,
    workerScript: gifWorkerUrl,
    width,
    height,
    repeat: 0,
    quality: 8,
    dither: 'FloydSteinberg-serpentine',
  })
  const sequence = shots.length > 1
    ? [...shots.map((_, index) => index), ...shots.slice(1, -1).map((_, index) => shots.length - 2 - index)]
    : [0]

  sequence.forEach((index) => {
    const photo = photos[index]
    const coverScale = Math.max(width / photo.naturalWidth, height / photo.naturalHeight)
    const drawWidth = photo.naturalWidth * coverScale
    const drawHeight = photo.naturalHeight * coverScale
    context.fillStyle = '#000000'
    context.fillRect(0, 0, width, height)
    context.drawImage(photo, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
    gif.addFrame(context, { copy: true, delay: 420, dispose: 2 })
  })

  return new Promise((resolve, reject) => {
    gif.on('finished', (blob) => {
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    })
    try {
      gif.render()
    } catch (error) {
      reject(error instanceof Error ? error : new Error('GIF boomerang tidak dapat dibuat.'))
    }
  })
}

export async function createSessionExportFiles({
  shots,
  frame,
  frameShots,
  adjustments,
}: {
  shots: string[]
  frame: BoothFrame | null
  frameShots: string[]
  adjustments: PhotoAdjustmentMap
}): Promise<SessionExportFile[]> {
  if (shots.length === 0) throw new Error('Sesi ini belum memiliki foto.')

  const resultPng = frame?.slots.length
    ? dataUrlToBytes(await composeFrame(frameShots, frame, adjustments))
    : await composeUnframedPhotos(shots)
  const photoFiles = await Promise.all(shots.map(async (shot, index) => ({
    name: `Foto ${String(index + 1).padStart(2, '0')}.png`,
    bytes: await pngBytesForShot(shot),
  })))
  const boomerang = await createBoomerangGif(shots)

  return [
    { name: 'Hasil.png', bytes: resultPng },
    ...photoFiles,
    { name: 'Boomerang.gif', bytes: boomerang },
  ]
}
