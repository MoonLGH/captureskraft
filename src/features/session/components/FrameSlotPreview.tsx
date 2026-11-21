import { useEffect, useRef, useState } from 'react'
import type { Experience } from '../../../types/app'
import { getFramePhotoIndexes, type BoothFrame } from '../../camera/boothFrames'

export function FrameSlotPreview({ frame, experience, className = '', compactBelow }: { frame: BoothFrame; experience: Experience; className?: string; compactBelow?: number }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const updateSize = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const scale = viewportSize.width && viewportSize.height
    ? Math.min(viewportSize.width / frame.width, viewportSize.height / frame.height)
    : 0
  const sourceIndexes = getFramePhotoIndexes(frame)
  const stageStyle = scale
    ? { width: `${frame.width * scale}px`, height: `${frame.height * scale}px` }
    : { aspectRatio: `${frame.width} / ${frame.height}`, width: '100%' }
  const compactSlots = compactBelow !== undefined
    && (viewportSize.width === 0 || viewportSize.height === 0 || Math.min(viewportSize.width, viewportSize.height) < compactBelow)

  return <div className={`frame-feature-stage-viewport ${className}`.trim()} ref={viewportRef}>
    <div className="frame-feature-stage" style={stageStyle}>
      {frame.dataUrl
        ? <img src={frame.dataUrl} alt={`Preview utuh frame ${frame.name}`} draggable={false} loading="lazy" />
        : <span className="frame-feature-empty-preview" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#8b747f', fontSize: 12 }}>Preview dimuat saat frame dipilih</span>}
      {frame.slots.map((slot, index) => <div
        className={`frame-feature-slot ${compactSlots ? 'frame-feature-slot-compact' : ''}`}
        key={slot.id}
        role="img"
        aria-label={`Slot ${index + 1}, foto ${experience === 'single' ? 1 : sourceIndexes.indexOf(slot.photoIndex) + 1}`}
        style={{
          left: `${(slot.x / frame.width) * 100}%`,
          top: `${(slot.y / frame.height) * 100}%`,
          width: `${(slot.width / frame.width) * 100}%`,
          height: `${(slot.height / frame.height) * 100}%`,
          transform: `rotate(${slot.rotation}deg)`,
          zIndex: index + 1,
        }}
      ><span>{experience === 'single' ? 1 : sourceIndexes.indexOf(slot.photoIndex) + 1}</span></div>)}
    </div>
  </div>
}
