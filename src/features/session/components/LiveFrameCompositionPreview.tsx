import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Experience } from '../../../types/app'
import { getFramePhotoIndexes, type BoothFrame } from '../../camera/boothFrames'
import { DEFAULT_SESSION_CAMERA_SETTINGS, drawImageWithCameraEffects, type SessionCameraSettings } from '../../camera/cameraEffects'

type PreviewAssets = { artwork: HTMLImageElement; photos: Map<number, HTMLImageElement> }

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Foto preview tidak dapat dimuat.'))
    image.src = source
  })
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function LiveFrameCompositionPreview({ frame, shots, experience, videoRef, retakePhotoIndex, onPreviewWidthChange, cameraSettings = DEFAULT_SESSION_CAMERA_SETTINGS }: {
  frame: BoothFrame
  shots: string[]
  experience: Experience
  videoRef: RefObject<HTMLVideoElement | null>
  retakePhotoIndex: number | null
  onPreviewWidthChange: (width: number) => void
  cameraSettings?: SessionCameraSettings
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [assets, setAssets] = useState<PreviewAssets | null>(null)
  const sourceIndexes = useMemo(() => getFramePhotoIndexes(frame), [frame])
  const sourceIndexesRef = useRef(sourceIndexes)
  const retakePhotoIndexRef = useRef(retakePhotoIndex)
  sourceIndexesRef.current = sourceIndexes
  retakePhotoIndexRef.current = retakePhotoIndex
  const shotAssignments = useMemo(() => sourceIndexes.flatMap((sourceIndex, index) => {
    const source = experience === 'single' ? shots[0] : shots[index]
    return source ? [{ sourceIndex, source }] : []
  }), [experience, shots, sourceIndexes])

  useEffect(() => {
    let active = true
    void Promise.all([loadImage(frame.dataUrl), ...shotAssignments.map(({ source }) => loadImage(source))]).then(([artwork, ...photos]) => {
      if (!active) return
      setAssets({ artwork, photos: new Map(shotAssignments.map(({ sourceIndex }, index) => [sourceIndex, photos[index]])) })
    }).catch(() => {
      if (active) setAssets(null)
    })
    return () => { active = false }
  }, [frame.dataUrl, shotAssignments])

  useEffect(() => {
    const updateSize = () => {
      const mobile = window.matchMedia('(max-width: 700px)').matches
      const width = Math.max(1, document.documentElement.clientWidth - 40)
      const height = Math.max(1, window.innerHeight * (mobile ? 0.27 : 0.34))
      setViewportSize({
        width: Math.min(mobile ? 320 : 380, width),
        height: Math.min(mobile ? 215 : 290, height),
      })
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !assets) return

    const scale = Math.min(1, 1200 / frame.width, 1200 / frame.height)
    canvas.width = Math.max(1, Math.round(frame.width * scale))
    canvas.height = Math.max(1, Math.round(frame.height * scale))
    let active = true
    let animation = 0
    let previousDraw = 0

    const draw = (time: number) => {
      if (!active) return
      if (time - previousDraw >= 1000 / 24) {
        previousDraw = time
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.save()
        context.scale(scale, scale)

        frame.slots.forEach((slot) => {
          const slotPhotoIndex = sourceIndexesRef.current.indexOf(slot.photoIndex)
          const isBeingRetaken = retakePhotoIndexRef.current === slotPhotoIndex
          const capturedPhoto = isBeingRetaken ? undefined : assets.photos.get(slot.photoIndex)
          const liveVideo = videoRef.current
          const useLiveVideo = !capturedPhoto && liveVideo && liveVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && liveVideo.videoWidth > 0
          const source = capturedPhoto ?? (useLiveVideo ? liveVideo : null)
          if (!source) return

          const sourceWidth = capturedPhoto?.naturalWidth ?? liveVideo?.videoWidth ?? 0
          const sourceHeight = capturedPhoto?.naturalHeight ?? liveVideo?.videoHeight ?? 0
          if (!sourceWidth || !sourceHeight) return
          const zoom = Math.max(1, slot.imageZoom || 1)
          const photoScale = Math.max(slot.width / sourceWidth, slot.height / sourceHeight) * zoom
          const imageWidth = sourceWidth * photoScale
          const imageHeight = sourceHeight * photoScale
          const maxPanX = Math.max(0, (imageWidth - slot.width) / 2)
          const maxPanY = Math.max(0, (imageHeight - slot.height) / 2)
          const offsetX = clamp(slot.imageOffsetX || 0, -1, 1) * maxPanX * (useLiveVideo ? -1 : 1)
          const offsetY = clamp(slot.imageOffsetY || 0, -1, 1) * maxPanY

          context.save()
          context.translate(slot.x + slot.width / 2, slot.y + slot.height / 2)
          context.rotate(slot.rotation * Math.PI / 180)
          context.beginPath()
          context.rect(-slot.width / 2, -slot.height / 2, slot.width, slot.height)
          context.clip()
          if (useLiveVideo) context.scale(-1, 1)
          drawImageWithCameraEffects(context, source, -imageWidth / 2 + offsetX, -imageHeight / 2 + offsetY, imageWidth, imageHeight, cameraSettings)
          context.restore()
        })

        context.drawImage(assets.artwork, 0, 0, frame.width, frame.height)
        context.restore()
      }
      animation = window.requestAnimationFrame(draw)
    }

    animation = window.requestAnimationFrame(draw)
    return () => {
      active = false
      window.cancelAnimationFrame(animation)
    }
  }, [assets, cameraSettings, frame, videoRef])

  const scale = viewportSize.width && viewportSize.height
    ? Math.min(viewportSize.width / frame.width, viewportSize.height / frame.height) * 1.15
    : 0
  useEffect(() => {
    onPreviewWidthChange(frame.width * scale)
  }, [frame.width, onPreviewWidthChange, scale])

  const stageStyle = { aspectRatio: `${frame.width} / ${frame.height}` }

  return <div className="live-frame-preview-viewport" style={stageStyle}>
    <div className="live-frame-preview-stage" style={stageStyle}>
      <canvas ref={canvasRef} aria-label={`Preview ${frame.name} dengan hasil foto di slot`} />
      {frame.slots.map((slot, index) => {
        const sourceIndex = sourceIndexes.indexOf(slot.photoIndex)
        const shotIndex = experience === 'single' ? 0 : sourceIndex
        const photoTaken = shotIndex >= 0 && Boolean(shots[shotIndex]) && retakePhotoIndex !== shotIndex
        return <div
          className="live-frame-slot-guide"
          key={slot.id}
          role="img"
          aria-label={`Slot ${index + 1}, foto ${experience === 'single' ? 1 : sourceIndex + 1}`}
          style={{
            left: `${(slot.x / frame.width) * 100}%`,
            top: `${(slot.y / frame.height) * 100}%`,
            width: `${(slot.width / frame.width) * 100}%`,
            height: `${(slot.height / frame.height) * 100}%`,
            transform: `rotate(${slot.rotation}deg)`,
            zIndex: index + 1,
          }}
        >{!photoTaken && <span>{shotIndex + 1}</span>}</div>
      })}
    </div>
  </div>
}
