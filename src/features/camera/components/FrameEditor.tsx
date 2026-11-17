import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Copy, ImagePlus, Move, RotateCw, Trash2 } from 'lucide-react'
import { createId, getFramePhotoIndexes, type BoothFrame, type FrameSlot } from '../boothFrames'

type FrameEditorProps = {
  frame: BoothFrame
  onChange: (frame: BoothFrame) => void
  onRename: (name: string) => void
  onRemove: (slotId: string) => void
  onDeleteFrame: () => void
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type TransformMode = 'move' | 'resize' | 'rotate'
type DragState = {
  pointerId: number
  slotId: string
  mode: TransformMode
  handle?: ResizeHandle
  startX: number
  startY: number
  startAngle: number
  initial: FrameSlot
  current: FrameSlot
}

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const radians = (degrees: number) => degrees * Math.PI / 180

function keepCenterInFrame(slot: FrameSlot, frame: BoothFrame, centerX: number, centerY: number): FrameSlot {
  const angle = radians(slot.rotation)
  const halfBoundsWidth = (Math.abs(slot.width * Math.cos(angle)) + Math.abs(slot.height * Math.sin(angle))) / 2
  const halfBoundsHeight = (Math.abs(slot.width * Math.sin(angle)) + Math.abs(slot.height * Math.cos(angle))) / 2
  const boundedX = halfBoundsWidth * 2 >= frame.width
    ? frame.width / 2
    : clamp(centerX, halfBoundsWidth, frame.width - halfBoundsWidth)
  const boundedY = halfBoundsHeight * 2 >= frame.height
    ? frame.height / 2
    : clamp(centerY, halfBoundsHeight, frame.height - halfBoundsHeight)
  return { ...slot, x: boundedX - slot.width / 2, y: boundedY - slot.height / 2 }
}

export function FrameEditor({ frame, onChange, onRename, onRemove, onDeleteFrame }: FrameEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<FrameSlot | null>(null)
  const selectedSlot = frame.slots.find((slot) => slot.id === selectedSlotId) ?? null
  const photoIndexes = getFramePhotoIndexes(frame)

  const updateSlot = (slotId: string, changes: Partial<FrameSlot>) => {
    const slots = frame.slots.map((slot) => slot.id === slotId ? { ...slot, ...changes } : slot)
    onChange({ ...frame, slots })
  }

  const addSlot = () => {
    const index = frame.slots.length
    const count = index + 1
    let width: number
    let height: number
    let x: number
    let y: number

    if (frame.height >= frame.width) {
      const cellHeight = frame.height / count
      width = frame.width * 0.8
      height = Math.max(1, Math.min(frame.height * 0.22, cellHeight * 0.8))
      x = (frame.width - width) / 2
      y = index * cellHeight + (cellHeight - height) / 2
    } else {
      const cellWidth = frame.width / count
      width = Math.max(1, Math.min(frame.width * 0.22, cellWidth * 0.8))
      height = frame.height * 0.8
      x = index * cellWidth + (cellWidth - width) / 2
      y = (frame.height - height) / 2
    }

    const photoIndex = Math.max(-1, ...photoIndexes) + 1
    const slot: FrameSlot = { id: createId('slot'), x, y, width, height, rotation: 0, photoIndex, imageZoom: 1, imageOffsetX: 0, imageOffsetY: 0 }
    setSelectedSlotId(slot.id)
    onChange({ ...frame, slots: [...frame.slots, slot] })
  }

  const duplicateSelectedSlot = () => {
    if (!selectedSlot) return
    const centerX = selectedSlot.x + selectedSlot.width / 2
    const centerY = selectedSlot.y + selectedSlot.height / 2
    const offsetX = Math.max(8, frame.width * 0.02) * (centerX + selectedSlot.width / 2 < frame.width ? 1 : -1)
    const offsetY = Math.max(8, frame.height * 0.02) * (centerY + selectedSlot.height / 2 < frame.height ? 1 : -1)
    const copy = keepCenterInFrame(
      { ...selectedSlot, id: createId('slot') },
      frame,
      centerX + offsetX,
      centerY + offsetY,
    )
    setSelectedSlotId(copy.id)
    onChange({ ...frame, slots: [...frame.slots, copy] })
  }

  const deleteSlot = (slotId: string) => {
    onRemove(slotId)
    if (selectedSlotId === slotId) setSelectedSlotId(null)
  }

  const startTransform = (
    event: ReactPointerEvent<HTMLElement>,
    slot: FrameSlot,
    mode: TransformMode,
    handle?: ResizeHandle,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedSlotId(slot.id)

    const bounds = stageRef.current?.getBoundingClientRect()
    const centerX = bounds ? bounds.left + ((slot.x + slot.width / 2) / frame.width) * bounds.width : event.clientX
    const centerY = bounds ? bounds.top + ((slot.y + slot.height / 2) / frame.height) * bounds.height : event.clientY
    const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX)
    dragRef.current = {
      pointerId: event.pointerId,
      slotId: slot.id,
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startAngle,
      initial: slot,
      current: slot,
    }
  }

  const transformSlot = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!drag || !bounds || drag.pointerId !== event.pointerId) return

    const initial = drag.initial
    const centerX = initial.x + initial.width / 2
    const centerY = initial.y + initial.height / 2
    const deltaX = ((event.clientX - drag.startX) / bounds.width) * frame.width
    const deltaY = ((event.clientY - drag.startY) / bounds.height) * frame.height
    let next = initial

    if (drag.mode === 'move') {
      next = keepCenterInFrame(initial, frame, centerX + deltaX, centerY + deltaY)
    } else if (drag.mode === 'rotate') {
      const centerScreenX = bounds.left + (centerX / frame.width) * bounds.width
      const centerScreenY = bounds.top + (centerY / frame.height) * bounds.height
      const angle = Math.atan2(event.clientY - centerScreenY, event.clientX - centerScreenX)
      let angleDelta = angle - drag.startAngle
      if (angleDelta > Math.PI) angleDelta -= Math.PI * 2
      if (angleDelta < -Math.PI) angleDelta += Math.PI * 2
      const rotation = initial.rotation + angleDelta * 180 / Math.PI
      next = keepCenterInFrame({ ...initial, rotation }, frame, centerX, centerY)
    } else if (drag.handle) {
      const angle = radians(initial.rotation)
      const localDeltaX = deltaX * Math.cos(angle) + deltaY * Math.sin(angle)
      const localDeltaY = -deltaX * Math.sin(angle) + deltaY * Math.cos(angle)
      const west = drag.handle.includes('w')
      const east = drag.handle.includes('e')
      const north = drag.handle.includes('n')
      const south = drag.handle.includes('s')
      const width = clamp(initial.width + (east ? localDeltaX : west ? -localDeltaX : 0), 1, frame.width)
      const height = clamp(initial.height + (south ? localDeltaY : north ? -localDeltaY : 0), 1, frame.height)
      const localCenterShiftX = (west || east) ? localDeltaX / 2 : 0
      const localCenterShiftY = (north || south) ? localDeltaY / 2 : 0
      const shiftedCenterX = centerX + localCenterShiftX * Math.cos(angle) - localCenterShiftY * Math.sin(angle)
      const shiftedCenterY = centerY + localCenterShiftX * Math.sin(angle) + localCenterShiftY * Math.cos(angle)
      next = keepCenterInFrame({ ...initial, width, height }, frame, shiftedCenterX, shiftedCenterY)
    }

    dragRef.current = { ...drag, current: next }
    setDragPreview(next)
  }

  const finishTransform = (pointerId: number) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== pointerId) return
    updateSlot(drag.slotId, drag.current)
    dragRef.current = null
    setDragPreview(null)
  }

  return (
    <div className="frame-editor">
      <div className="frame-editor-toolbar">
        <label className="frame-name-field">Nama frame<input value={frame.name} onChange={(event) => onRename(event.target.value)} /></label>
        <div className="frame-editor-actions">
          <span className="frame-native-size">{frame.width} Ã— {frame.height} px Â· ukuran asli</span>
          <button className="soft-button" type="button" onClick={addSlot}><ImagePlus size={15} /> Tambah foto baru</button>
          <button className="soft-button" type="button" disabled={!selectedSlot} onClick={duplicateSelectedSlot}><Copy size={14} /> Duplikat foto</button>
          <button className="frame-remove-button" type="button" onClick={onDeleteFrame}><Trash2 size={15} /> Hapus frame</button>
        </div>
      </div>
      <p className="frame-transform-help">Geser area untuk memindahkan; handle sisi/sudut mengubah ukuran; handle bulat memutar. Duplikat foto menyalin sumber, ukuran, dan sudut. Saat hasil disusun, semua foto berada di bawah template PNG.</p>

      <div className="frame-editor-workspace">
        <div
          ref={stageRef}
          className="frame-editor-stage"
          style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
          onPointerMove={transformSlot}
          onPointerUp={(event) => finishTransform(event.pointerId)}
          onPointerCancel={(event) => finishTransform(event.pointerId)}
          onLostPointerCapture={(event) => finishTransform(event.pointerId)}
        >
          {frame.slots.map((slot, index) => {
            const shown = dragPreview?.id === slot.id ? dragPreview : slot
            const selected = selectedSlotId === slot.id
            return <div
              key={slot.id}
              className={`frame-photo-slot ${selected ? 'selected' : ''}`}
              role="group"
              aria-label={`Transform control foto ${index + 1}`}
              style={{
                left: `${(shown.x / frame.width) * 100}%`,
                top: `${(shown.y / frame.height) * 100}%`,
                width: `${(shown.width / frame.width) * 100}%`,
                height: `${(shown.height / frame.height) * 100}%`,
                transform: `rotate(${shown.rotation}deg)`,
                zIndex: selected ? frame.slots.length + 10 : 1,
              }}
              onPointerDown={(event) => startTransform(event, shown, 'move')}
            >
              <span className="frame-slot-label"><Move size={12} /> Slot {index + 1} Â· Foto {photoIndexes.indexOf(slot.photoIndex) + 1}</span>
              {selected && <>
                {HANDLES.map((handle) => <button
                  key={handle}
                  className={`transform-handle handle-${handle}`}
                  type="button"
                  aria-label={`Ubah ukuran foto ${index + 1}, handle ${handle}`}
                  onPointerDown={(event) => startTransform(event, shown, 'resize', handle)}
                />)}
                <button
                  className="transform-handle handle-rotate"
                  type="button"
                  aria-label={`Putar foto ${index + 1}`}
                  onPointerDown={(event) => startTransform(event, shown, 'rotate')}
                ><RotateCw size={10} /></button>
              </>}
            </div>
          })}
          <img className="frame-editor-artwork" src={frame.dataUrl} alt={`Preview frame ${frame.name}`} draggable={false} />
          {frame.slots.length === 0 && <div className="frame-editor-empty-hint">Tambah slot untuk menentukan posisi foto</div>}
        </div>

        <aside className="frame-slot-list">
          <div className="frame-slot-list-heading"><b>Posisi foto</b><small>{frame.slots.length} slot Â· {photoIndexes.length} foto sumber unik</small></div>
          {frame.slots.length === 0 && <p className="frame-no-slots">Tambahkan slot lalu geser dan atur handle seperti transform control.</p>}
          {frame.slots.map((slot, index) => (
            <div className={`frame-slot-item ${selectedSlotId === slot.id ? 'selected' : ''}`} key={slot.id}>
              <button className="frame-slot-select" type="button" onClick={() => setSelectedSlotId(slot.id)}>Slot {index + 1}</button>
              <select
                className="frame-slot-source"
                aria-label={`Pilih foto sumber untuk slot ${index + 1}`}
                value={slot.photoIndex}
                onFocus={() => setSelectedSlotId(slot.id)}
                onChange={(event) => updateSlot(slot.id, { photoIndex: Number(event.target.value) })}
              >{photoIndexes.map((photoIndex, sourceIndex) => <option key={photoIndex} value={photoIndex}>Foto {sourceIndex + 1}</option>)}</select>
              <button className="frame-slot-delete" type="button" aria-label={`Hapus slot foto ${index + 1}`} onClick={() => deleteSlot(slot.id)}><Trash2 size={14} /></button>
            </div>
          ))}
          {selectedSlot && <div className="frame-slot-controls">
            <b>Transformasi presisi (px)</b>
            <label>X<input type="number" min="0" max={frame.width - selectedSlot.width} step="any" value={Number(selectedSlot.x.toFixed(2))} onChange={(event) => updateSlot(selectedSlot.id, { x: clamp(Number(event.target.value), 0, frame.width - selectedSlot.width) })} /></label>
            <label>Y<input type="number" min="0" max={frame.height - selectedSlot.height} step="any" value={Number(selectedSlot.y.toFixed(2))} onChange={(event) => updateSlot(selectedSlot.id, { y: clamp(Number(event.target.value), 0, frame.height - selectedSlot.height) })} /></label>
            <label>Lebar<input type="number" min="1" max={frame.width - selectedSlot.x} step="any" value={Number(selectedSlot.width.toFixed(2))} onChange={(event) => updateSlot(selectedSlot.id, { width: clamp(Number(event.target.value), 1, frame.width - selectedSlot.x) })} /></label>
            <label>Tinggi<input type="number" min="1" max={frame.height - selectedSlot.y} step="any" value={Number(selectedSlot.height.toFixed(2))} onChange={(event) => updateSlot(selectedSlot.id, { height: clamp(Number(event.target.value), 1, frame.height - selectedSlot.y) })} /></label>
            <label>Rotasi (Â°)<input type="number" step="any" value={Number(selectedSlot.rotation.toFixed(2))} onChange={(event) => updateSlot(selectedSlot.id, { rotation: Number(event.target.value) || 0 })} /></label>
          </div>}
        </aside>
      </div>
    </div>
  )
}
