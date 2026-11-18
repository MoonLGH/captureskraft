import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { drawFrameComposition, type PhotoAdjustment, type PhotoAdjustmentMap } from '../composeFrame'
import { getFramePhotoIndexes, type BoothFrame, type FrameSlot } from '../boothFrames'

type InteractiveFramePreviewProps = {
  frame: BoothFrame
  shots: string[]
  adjustments: PhotoAdjustmentMap
  selectedSlotId: string
  onSelectSlot: (slotId: string) => void
  onChangeAdjustment: (slotId: string, adjustment: PhotoAdjustment) => void
  onReady: (ready: boolean) => void
}

type PreviewAssets = { artwork: HTMLImageElement; photos: Map<number, HTMLImageElement> }
type PanState = {
  pointerId: number
  slot: FrameSlot
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  maxPanX: number
  maxPanY: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const radians = (degrees: number) => degrees * Math.PI / 180

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gambar foto tidak dapat dimuat.'))
    image.src = source
  })
}

export function InteractiveFramePreview({ frame, shots, adjustments, selectedSlotId, onSelectSlot, onChangeAdjustment, onReady }: InteractiveFramePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const panRef = useRef<PanState | null>(null)
  const [assets, setAssets] = useState<PreviewAssets | null>(null)
  const [error, setError] = useState('')
  const photoIndexes = getFramePhotoIndexes(frame)
  const photoIndexesKey = photoIndexes.join(',')
  const previewHeightRatio = window.innerWidth >= 1200 && window.innerHeight >= 650 ? 0.48 : 0.62
  const previewWidth = Math.min(520, Math.max(1, window.innerHeight * previewHeightRatio * frame.width / frame.height))

  useEffect(() => {
    let active = true
    setAssets(null)
    setError('')
    onReady(false)
    const sources = photoIndexes.map((photoIndex, index) => ({ photoIndex, source: shots[index] }))
      .filter((item): item is { photoIndex: number; source: string } => Boolean(item.source))
    void Promise.all([loadImage(frame.dataUrl), ...sources.map(({ source }) => loadImage(source))]).then(([artwork, ...photos]) => {
      if (!active) return
      setAssets({ artwork, photos: new Map(sources.map(({ photoIndex }, index) => [photoIndex, photos[index]])) })
    }).catch(() => {
      if (active) {
        setError('Preview frame atau foto tidak dapat dimuat.')
        onReady(true)
      }
    })
    return () => { active = false }
  }, [frame.dataUrl, onReady, photoIndexesKey, shots])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !assets) return
    if (!context) {
      setError('Canvas preview tidak tersedia pada perangkat ini.')
      onReady(true)
      return
    }
    const scale = Math.min(1, 1200 / frame.width, 1200 / frame.height)
    canvas.width = Math.max(1, Math.round(frame.width * scale))
    canvas.height = Math.max(1, Math.round(frame.height * scale))
    context.clearRect(0, 0, canvas.width, canvas.height)
    try {
      context.save()
      context.scale(scale, scale)
      drawFrameComposition(context, frame, assets.photos, assets.artwork, adjustments)
      context.restore()
      setError('')
      onReady(true)
    } catch {
      context.restore()
      setError('Preview hasil foto tidak dapat disusun.')
      onReady(true)
    }
  }, [adjustments, assets, frame, onReady])

  const startPan = (event: ReactPointerEvent<HTMLDivElement>, slot: FrameSlot) => {
    event.preventDefault()
    event.stopPropagation()
    onSelectSlot(slot.id)
    const photo = assets?.photos.get(slot.photoIndex)
    if (!photo) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const current = adjustments[slot.id] ?? slot
    const zoom = Math.max(1, current.imageZoom || 1)
    const scale = Math.max(slot.width / photo.naturalWidth, slot.height / photo.naturalHeight) * zoom
    panRef.current = {
      pointerId: event.pointerId,
      slot,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: current.imageOffsetX || 0,
      offsetY: current.imageOffsetY || 0,
      maxPanX: Math.max(0, (photo.naturalWidth * scale - slot.width) / 2),
      maxPanY: Math.max(0, (photo.naturalHeight * scale - slot.height) / 2),
    }
  }

  const dragPhoto = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!pan || !bounds || pan.pointerId !== event.pointerId) return
    const deltaX = ((event.clientX - pan.startX) / bounds.width) * frame.width
    const deltaY = ((event.clientY - pan.startY) / bounds.height) * frame.height
    const angle = radians(pan.slot.rotation)
    const localDeltaX = deltaX * Math.cos(angle) + deltaY * Math.sin(angle)
    const localDeltaY = -deltaX * Math.sin(angle) + deltaY * Math.cos(angle)
    const current = adjustments[pan.slot.id] ?? pan.slot
    onChangeAdjustment(pan.slot.id, {
      imageZoom: current.imageZoom || 1,
      imageOffsetX: pan.maxPanX ? clamp(pan.offsetX + localDeltaX / pan.maxPanX, -1, 1) : 0,
      imageOffsetY: pan.maxPanY ? clamp(pan.offsetY + localDeltaY / pan.maxPanY, -1, 1) : 0,
    })
  }

  const finishPan = (pointerId: number) => {
    if (panRef.current?.pointerId === pointerId) panRef.current = null
  }

  return (
    <div className="interactive-frame-preview-wrap">
      <div
        className="interactive-frame-preview"
        style={{ aspectRatio: `${frame.width} / ${frame.height}`, width: `${previewWidth}px`, maxWidth: '100%' }}
        onPointerMove={dragPhoto}
        onPointerUp={(event) => finishPan(event.pointerId)}
        onPointerCancel={(event) => finishPan(event.pointerId)}
        onLostPointerCapture={(event) => finishPan(event.pointerId)}
      >
        <canvas ref={canvasRef} className="interactive-frame-canvas" aria-label="Preview hasil foto berframe" />
        {frame.slots.map((slot, index) => <div
          key={slot.id}
          className={`frame-adjust-target ${assets?.photos.has(slot.photoIndex) ? 'has-photo' : ''} ${selectedSlotId === slot.id ? 'selected' : ''}`}
          aria-label={`Seret slot untuk mengatur crop`}
          role="group"
          style={{
            left: `${(slot.x / frame.width) * 100}%`,
            top: `${(slot.y / frame.height) * 100}%`,
            width: `${(slot.width / frame.width) * 100}%`,
            height: `${(slot.height / frame.height) * 100}%`,
            transform: `rotate(${slot.rotation}deg)`,
            zIndex: selectedSlotId === slot.id ? frame.slots.length + 5 : index + 3,
          }}
          onPointerDown={(event) => startPan(event, slot)}
        />)}
        {error && <div className="frame-preview-error">{error}</div>}
        {!assets && !error && <div className="frame-preview-loading">Menyiapkan preview...</div>}
      </div>
      <small className="frame-preview-tip">Seret area foto untuk menggeser crop; atur zoom di panel samping.</small>
    </div>
  )
}
