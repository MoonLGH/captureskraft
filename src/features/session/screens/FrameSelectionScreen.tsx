import { ArrowLeft, ArrowRight, Check, Image as ImageIcon } from 'lucide-react'
import type { Experience } from '../../../types/app'
import { getFramePhotoIndexes, type BoothFrame } from '../../camera/boothFrames'
import { FrameSlotPreview } from '../components/FrameSlotPreview'

type FrameSelectionScreenProps = {
  experience: Experience
  frames: BoothFrame[]
  selectedFrameId: string | null | undefined
  onSelectFrame: (frameId: string | null) => void
  onBack: () => void
  onContinue: () => void
}

export function FrameSelectionScreen({ experience, frames, selectedFrameId, onSelectFrame, onBack, onContinue }: FrameSelectionScreenProps) {
  const previewHeight = Math.min(230, Math.max(120, window.innerHeight * 0.22))
  const noFrameSelected = selectedFrameId === null
  const hasSelection = noFrameSelected || frames.some((frame) => frame.id === selectedFrameId)

  return (
    <section className="flow-page frame-selection-page">
      <div className="flow-heading frame-selection-heading">
        <h2>Pilih tampilan fotomu.</h2>
      </div>

      <div className="frame-selection-workspace">
        <div className="frame-showcase-column">
          {frames.length === 0
            ? <button className={`frame-gallery-card no-frame-choice ${noFrameSelected ? 'selected' : ''}`} type="button" aria-pressed={noFrameSelected} onClick={() => onSelectFrame(null)}>
              <span className="frame-gallery-art no-frame-art"><ImageIcon size={26} /></span>
              <span className="frame-gallery-info"><b>Tanpa frame</b><small>Gunakan hasil foto tanpa overlay.</small></span>
              <span className="frame-gallery-select">{noFrameSelected ? <><Check size={14} /> Dipilih</> : 'Pilih'}</span>
            </button>
            : <div className="frame-carousel" role="region" aria-label="Galeri frame, gulir untuk melihat semua pilihan" tabIndex={0}>
              <div className="frame-carousel-track">
                {frames.map((frame) => {
                  const selected = selectedFrameId === frame.id
                  const count = experience === 'strip' ? getFramePhotoIndexes(frame).length || 3 : 1
                  const previewWidth = Math.round(previewHeight * frame.width / frame.height)
                  return <button className={`frame-gallery-card ${selected ? 'selected' : ''}`} key={frame.id} style={{ width: `${previewWidth}px` }} type="button" aria-pressed={selected} onClick={() => onSelectFrame(frame.id)}>
                    <div className="frame-gallery-art" style={{ width: '100%', height: `${previewHeight}px` }}><FrameSlotPreview frame={frame} experience={experience} className="frame-gallery-preview-viewport" /></div>
                    <span className="frame-gallery-info"><b>{frame.name}</b><small>{count} {experience === 'strip' ? 'pose' : 'jepretan'} {'\u00b7'} {frame.slots.length} area foto</small></span>
                    <span className="frame-gallery-select">{selected ? <><Check size={14} /> Dipilih</> : 'Pilih frame'}</span>
                  </button>
                })}
              </div>
            </div>}
        </div>

      </div>

      <div className="flow-actions frame-selection-actions">
        <button className="soft-button" type="button" onClick={onBack}><ArrowLeft size={18} /> Kembali</button>
        <button className="primary-cta compact" type="button" onClick={onContinue} disabled={!hasSelection}>
          <span>{hasSelection ? 'Lanjut ke kamera' : 'Pilih frame untuk lanjut'}</span><span className="cta-icon"><ArrowRight size={20} /></span>
        </button>
      </div>
      <div className="flow-progress"><span className="active" /><span className="active" /><span className="active" /><span className="active" /><span /></div>
    </section>
  )
}
