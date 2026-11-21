import GIF from 'gif.js'
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url'
import { composeFrame, type PhotoAdjustmentMap } from '../camera/composeFrame'
import { getFramePhotoIndexes, type BoothFrame } from '../camera/boothFrames'
import { DEFAULT_SESSION_CAMERA_SETTINGS, drawImageWithCameraEffects, type SessionCameraSettings } from '../camera/cameraEffects'

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

async function pngBytesForShot(source: string, cameraSettings: SessionCameraSettings): Promise<Uint8Array> {
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas tidak tersedia untuk menyimpan foto.')
  drawImageWithCameraEffects(context, image, 0, 0, canvas.width, canvas.height, cameraSettings)
  return canvasToPngBytes(canvas)
}

async function composeUnframedPhotos(shots: string[], cameraSettings: SessionCameraSettings): Promise<Uint8Array> {
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
    drawImageWithCameraEffects(context, photo, (panelWidth - width) / 2, index * panelHeight + (panelHeight - height) / 2, width, height, cameraSettings)
  })
  return canvasToPngBytes(canvas)
}

async function createBoomerangGif(shots: string[], cameraSettings: SessionCameraSettings): Promise<Uint8Array> {
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
    repeat: 2,
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
    drawImageWithCameraEffects(context, photo, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight, cameraSettings)
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

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

async function loadVideo(bytes: Uint8Array): Promise<{ video: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(new Blob([bytesToArrayBuffer(bytes)], { type: 'video/mp4' }))
  const video = document.createElement('video')
  video.muted = true
  video.loop = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('canplay', () => resolve(), { once: true })
      video.addEventListener('error', () => reject(new Error('Klip Live Photo tidak dapat dibaca.')), { once: true })
      video.load()
    })
    return { video, url }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function startVideoRecorder(canvas: HTMLCanvasElement, draw: () => void): Promise<Uint8Array> {
  const playbackDurationMs = 9000
  const mimeType = ['video/mp4;codecs=avc1', 'video/mp4;codecs=vp9', 'video/mp4']
    .find((candidate) => MediaRecorder.isTypeSupported(candidate))
  if (!mimeType) throw new Error('Format MP4 tidak didukung untuk membuat Live Photos di perangkat ini.')
  const stream = canvas.captureStream(24)
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_500_000 })
  } catch {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error('Perekam MP4 tidak tersedia untuk membuat Live Photos.')
  }

  return new Promise((resolve, reject) => {
    const chunks: BlobPart[] = []
    let animation = 0
    let stopTimer = 0
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => {
      window.cancelAnimationFrame(animation)
      window.clearTimeout(stopTimer)
      stream.getTracks().forEach((track) => track.stop())
      reject(new Error('Video Live Photos gagal dibuat.'))
    }
    recorder.onstop = () => {
      window.cancelAnimationFrame(animation)
      window.clearTimeout(stopTimer)
      stream.getTracks().forEach((track) => track.stop())
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType })
      if (!blob.size) {
        reject(new Error('Video Live Photos kosong.'))
        return
      }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }

    const startedAt = performance.now()
    const render = (time: number) => {
      draw()
      if (time - startedAt >= playbackDurationMs) {
        if (recorder.state !== 'inactive') recorder.stop()
        return
      }
      animation = window.requestAnimationFrame(render)
    }
    try {
      draw()
      recorder.start(100)
      animation = window.requestAnimationFrame(render)
      stopTimer = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop()
      }, playbackDurationMs + 400)
    } catch (error) {
      window.cancelAnimationFrame(animation)
      stream.getTracks().forEach((track) => track.stop())
      reject(error instanceof Error ? error : new Error('Video Live Photos gagal dimulai.'))
    }
  })
}

function drawLivePhotoFrame(
  context: CanvasRenderingContext2D,
  frame: BoothFrame,
  artwork: HTMLImageElement,
  videoByShotIndex: Map<number, HTMLVideoElement>,
  liveClips: (Uint8Array | null)[],
  adjustments: PhotoAdjustmentMap,
  cameraSettings: SessionCameraSettings,
) {
  const sourceIndexes = getFramePhotoIndexes(frame)
  frame.slots.forEach((slot) => {
    const shotIndex = sourceIndexes.indexOf(slot.photoIndex)
    const video = shotIndex >= 0 && liveClips[shotIndex] ? videoByShotIndex.get(shotIndex) : undefined
    if (!video || !video.videoWidth || !video.videoHeight) return

    const adjustment = adjustments[slot.id] ?? slot
    const zoom = Math.max(1, adjustment.imageZoom || 1)
    const scale = Math.max(slot.width / video.videoWidth, slot.height / video.videoHeight) * zoom
    const imageWidth = video.videoWidth * scale
    const imageHeight = video.videoHeight * scale
    const maxPanX = Math.max(0, (imageWidth - slot.width) / 2)
    const maxPanY = Math.max(0, (imageHeight - slot.height) / 2)
    const offsetX = Math.max(-1, Math.min(1, adjustment.imageOffsetX || 0)) * maxPanX * -1
    const offsetY = Math.max(-1, Math.min(1, adjustment.imageOffsetY || 0)) * maxPanY

    context.save()
    context.translate(slot.x + slot.width / 2, slot.y + slot.height / 2)
    context.rotate(slot.rotation * Math.PI / 180)
    context.beginPath()
    context.rect(-slot.width / 2, -slot.height / 2, slot.width, slot.height)
    context.clip()
    context.scale(-1, 1)
    drawImageWithCameraEffects(context, video, -imageWidth / 2 + offsetX, -imageHeight / 2 + offsetY, imageWidth, imageHeight, cameraSettings)
    context.restore()
  })

  context.drawImage(artwork, 0, 0, frame.width, frame.height)
}

async function createLivePhotoVideo(
  liveClips: (Uint8Array | null)[],
  frame: BoothFrame | null,
  adjustments: PhotoAdjustmentMap,
  cameraSettings: SessionCameraSettings,
): Promise<Uint8Array | null> {
  const sourceClips = liveClips.flatMap((clip, shotIndex) => clip ? [{ clip, shotIndex }] : [])
  if (sourceClips.length === 0) return null

  const loaded: { clip: Uint8Array; shotIndex: number; video: HTMLVideoElement; url: string }[] = []
  try {
    for (const { clip, shotIndex } of sourceClips) {
      const result = await loadVideo(clip)
      loaded.push({ clip, shotIndex, ...result })
    }
    await Promise.all(loaded.map(({ video }) => video.play()))

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas tidak tersedia untuk menyusun Live Photos.')
    const videoByShotIndex = new Map<number, HTMLVideoElement>(loaded.map(({ shotIndex, video }) => [shotIndex, video] as const))

    if (frame?.slots.length) {
      const scale = Math.min(1, 1200 / frame.width, 1200 / frame.height)
      canvas.width = Math.max(1, Math.round(frame.width * scale))
      canvas.height = Math.max(1, Math.round(frame.height * scale))
      const artwork = await loadImage(frame.dataUrl)
      return await startVideoRecorder(canvas, () => {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.save()
        context.scale(scale, scale)
        drawLivePhotoFrame(context, frame, artwork, videoByShotIndex, liveClips, adjustments, cameraSettings)
        context.restore()
      })
    }

    const width = 640
    const height = 480
    canvas.width = width
    canvas.height = height * loaded.length
    return await startVideoRecorder(canvas, () => {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      loaded.forEach(({ video }, index) => {
        if (!video.videoWidth || !video.videoHeight) return
        const scale = Math.min(width / video.videoWidth, height / video.videoHeight)
        const drawWidth = video.videoWidth * scale
        const drawHeight = video.videoHeight * scale
        context.save()
        context.translate(width / 2, index * height + height / 2)
        context.scale(-1, 1)
        drawImageWithCameraEffects(context, video, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight, cameraSettings)
        context.restore()
      })
    })
  } finally {
    loaded.forEach(({ video, url }) => {
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    })
  }
}

export async function createSessionExportFiles({
  shots,
  liveClips,
  frame,
  frameShots,
  adjustments,
  cameraSettings = DEFAULT_SESSION_CAMERA_SETTINGS,
}: {
  shots: string[]
  liveClips: (Uint8Array | null)[]
  frame: BoothFrame | null
  frameShots: string[]
  adjustments: PhotoAdjustmentMap
  cameraSettings?: SessionCameraSettings
}): Promise<SessionExportFile[]> {
  if (shots.length === 0) throw new Error('Sesi ini belum memiliki foto.')

  const resultPng = frame?.slots.length
    ? dataUrlToBytes(await composeFrame(frameShots, frame, adjustments, cameraSettings))
    : await composeUnframedPhotos(shots, cameraSettings)
  const photoFiles = await Promise.all(shots.map(async (shot, index) => ({
    name: `Foto ${String(index + 1).padStart(2, '0')}.png`,
    bytes: await pngBytesForShot(shot, cameraSettings),
  })))
  const boomerang = await createBoomerangGif(shots, cameraSettings)
  const livePhotos = await createLivePhotoVideo(liveClips, frame, adjustments, cameraSettings)

  return [
    { name: 'Hasil.png', bytes: resultPng },
    ...photoFiles,
    { name: 'Boomerang.gif', bytes: boomerang },
    ...(livePhotos ? [{ name: 'Live Photos.mp4', bytes: livePhotos }] : []),
  ]
}
