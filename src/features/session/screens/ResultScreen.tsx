import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Move, Printer, RefreshCw, Save, Sparkles, ZoomIn } from 'lucide-react'
import { InteractiveFramePreview } from '../../camera/components/InteractiveFramePreview'
import { getFramePhotoIndexes } from '../../camera/boothFrames'
import type { BoothFrame, FrameSlot } from '../../camera/boothFrames'
import type { PhotoAdjustment, PhotoAdjustmentMap } from '../../camera/composeFrame'
import type { Experience } from '../../../types/app'
import { createSessionExportFiles, type SessionExportFile } from '../sessionExport'

type ResultScreenProps = {
  experience: Experience
  shots: string[]
  frame: BoothFrame | null
  onRetake: () => void
  onFinish: (files: SessionExportFile[]) => Promise<void>
  onSaveFramePreset: (frame: BoothFrame) => Promise<boolean>
}

function defaultAdjustment(slot: FrameSlot): PhotoAdjustment {
  return { imageZoom: slot.imageZoom, imageOffsetX: slot.imageOffsetX, imageOffsetY: slot.imageOffsetY }
}

export function ResultScreen({ experience, shots, frame, onRetake, onFinish, onSaveFramePreset }: ResultScreenProps) {
  const [adjustments, setAdjustments] = useState<PhotoAdjustmentMap>({})
  const [selectedSlotId, setSelectedSlotId] = useState(frame?.slots[0]?.id ?? '')
  const [previewReady, setPreviewReady] = useState(false)
  const [presetMessage, setPresetMessage] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)
  const [savingSession, setSavingSession] = useState(false)
  const [sessionSaveError, setSessionSaveError] = useState('')
  const photoIndexes = frame ? getFramePhotoIndexes(frame) : []
  const frameShots = useMemo(() => frame && experience === 'single' && shots.length > 0
    ? Array.from({ length: photoIndexes.length }, () => shots[0])
    : shots, [experience, frame, photoIndexes.length, shots])
  const selectedSlot = frame?.slots.find((slot) => slot.id === selectedSlotId) ?? null
  const selectedPhotoIndex = selectedSlot ? photoIndexes.indexOf(selectedSlot.photoIndex) : -1
  const selectedPhotoAvailable = selectedPhotoIndex >= 0 && Boolean(frameShots[selectedPhotoIndex])
  const selectedAdjustment = selectedSlot
    ? adjustments[selectedSlot.id] ?? defaultAdjustment(selectedSlot)
    : { imageZoom: 1, imageOffsetX: 0, imageOffsetY: 0 }

  useEffect(() => {
    setAdjustments({})
    setSelectedSlotId(frame?.slots[0]?.id ?? '')
    setPresetMessage('')
    setPreviewReady(false)
  }, [frame?.id, shots])

  const updateSelectedAdjustment = (changes: Partial<PhotoAdjustment>) => {
    if (!selectedSlot) return
    setAdjustments((current) => ({
      ...current,
      [selectedSlot.id]: { ...(current[selectedSlot.id] ?? defaultAdjustment(selectedSlot)), ...changes },
    }))
  }

  const resetSelectedAdjustment = () => {
    if (!selectedSlot) return
    setAdjustments((current) => {
      const next = { ...current }
      delete next[selectedSlot.id]
      return next
    })
  }

  const saveCropDefaults = async () => {
    if (!frame) return
    const updatedFrame: BoothFrame = {
      ...frame,
      slots: frame.slots.map((slot) => ({ ...slot, ...(adjustments[slot.id] ?? defaultAdjustment(slot)) })),
    }
    setSavingPreset(true)
    setPresetMessage('')
    try {
      const saved = await onSaveFramePreset(updatedFrame)
      setPresetMessage(saved ? 'Penyesuaian crop disimpan sebagai default preset frame.' : 'Preset crop gagal disimpan.')
    } finally {
      setSavingPreset(false)
    }
  }

  const saveSession = async () => {
    setSavingSession(true)
    setSessionSaveError('')
    try {
      if (!window.boothConfig?.saveSession) throw new Error('Penyimpanan sesi hanya tersedia di aplikasi desktop.')
      const files = await createSessionExportFiles({ shots, frame, frameShots, adjustments })
      await onFinish(files)
    } catch (error) {
      setSessionSaveError(error instanceof Error ? error.message : 'Sesi gagal disimpan.')
    } finally {
      setSavingSession(false)
    }
  }

  const hasFrame = Boolean(frame?.slots.length)
  const previewIsLoading = hasFrame && !previewReady

  return (
    <section className="flow-page result-page">
      <div className="result-heading"><span className="success-badge"><Sparkles size={17} /> HASIL FOTO SIAP</span><h2>Lucu banget! ✨</h2><p>Geser foto di dalam slot atau gunakan kontrol zoom untuk mengatur area yang terlihat.</p></div>

      {frame && frame.slots.length > 0
        ? <div className="frame-adjust-layout">
          <div className="framed-result-preview">
            <InteractiveFramePreview
              frame={frame}
              shots={frameShots}
              adjustments={adjustments}
              selectedSlotId={selectedSlotId}
              onSelectSlot={setSelectedSlotId}
              onChangeAdjustment={(slotId, adjustment) => setAdjustments((current) => ({ ...current, [slotId]: adjustment }))}
              onReady={setPreviewReady}
            />
          </div>
          <aside className="frame-adjust-panel admin-card">
            <div className="frame-adjust-heading"><span className="config-icon mongo-icon"><ZoomIn size={18} /></span><div><b>Adjust image</b><small>Atur crop foto untuk setiap slot.</small></div></div>
            <label className="frame-adjust-field">Slot foto
              <select className="admin-input" value={selectedSlotId} onChange={(event) => setSelectedSlotId(event.target.value)}>
                {frame.slots.map((slot, index) => {
                  const sourceIndex = photoIndexes.indexOf(slot.photoIndex)
                  return <option key={slot.id} value={slot.id}>Slot {index + 1} · Foto {sourceIndex + 1}{sourceIndex >= shots.length ? ' (belum diambil)' : ''}</option>
                })}
              </select>
            </label>
            <p className="frame-adjust-help"><Move size={13} /> Seret foto pada preview untuk menggeser area crop.</p>
            <label className="frame-adjust-slider"><span><b>Zoom</b><small>{selectedAdjustment.imageZoom.toFixed(2)}×</small></span>
              <input type="range" min="1" max="4" step="0.01" value={Math.min(4, Math.max(1, selectedAdjustment.imageZoom))} disabled={!selectedPhotoAvailable} onChange={(event) => updateSelectedAdjustment({ imageZoom: Number(event.target.value) })} />
            </label>
            <label className="frame-adjust-slider"><span><b>Area horizontal</b><small>{Math.round(selectedAdjustment.imageOffsetX * 100)}%</small></span>
              <input type="range" min="-1" max="1" step="0.01" value={selectedAdjustment.imageOffsetX} disabled={!selectedPhotoAvailable} onChange={(event) => updateSelectedAdjustment({ imageOffsetX: Number(event.target.value) })} />
            </label>
            <label className="frame-adjust-slider"><span><b>Area vertikal</b><small>{Math.round(selectedAdjustment.imageOffsetY * 100)}%</small></span>
              <input type="range" min="-1" max="1" step="0.01" value={selectedAdjustment.imageOffsetY} disabled={!selectedPhotoAvailable} onChange={(event) => updateSelectedAdjustment({ imageOffsetY: Number(event.target.value) })} />
            </label>
            <button className="soft-button frame-adjust-reset" type="button" disabled={!selectedSlot || !selectedPhotoAvailable} onClick={resetSelectedAdjustment}><RefreshCw size={14} /> Reset ke preset</button>
            <button className="soft-button frame-adjust-save" type="button" disabled={savingPreset} onClick={() => { void saveCropDefaults() }}><Save size={14} /> {savingPreset ? 'Menyimpan...' : 'Simpan crop ke preset frame'}</button>
            {presetMessage && <small className="frame-adjust-saved-message">{presetMessage}</small>}
            {!selectedPhotoAvailable && <small className="field-help">Foto sumber slot ini belum diambil pada format sesi yang dipilih.</small>}
          </aside>
        </div>
        : <div className={`result-strip ${experience === 'single' ? 'single-result' : ''}`}>
          {shots.map((shot, index) => <div className="result-photo" key={`${index}-${shot.slice(-10)}`}><img src={shot} alt={`Hasil foto ${index + 1}`} /><span>CAPTURS · {String(index + 1).padStart(2, '0')}</span></div>)}
          <span className="result-brand">CAPTURS PHOTOBOOTH · JAKARTA</span>
        </div>}

      {sessionSaveError && <p className="session-save-error" role="alert">{sessionSaveError}</p>}
      <div className="result-actions"><button className="soft-button" onClick={onRetake} disabled={savingSession}><RefreshCw size={17} /> Foto ulang</button><button className="primary-cta compact" onClick={() => { void saveSession() }} disabled={previewIsLoading || savingSession}><span>{savingSession ? 'Menyimpan sesi…' : previewIsLoading ? 'Menyiapkan hasil…' : 'Simpan & cetak foto'}</span><span className="cta-icon"><ArrowRight size={20} /></span></button></div>
      <div className="print-note"><Printer size={15} /> Printer akan mulai setelah sesi tersimpan.</div>
    </section>
  )
}
