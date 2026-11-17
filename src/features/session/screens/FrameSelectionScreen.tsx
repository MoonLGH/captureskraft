import { ArrowLeft, ArrowRight, Check, Image as ImageIcon } from 'lucide-react'
import type { Experience } from '../../../types/app'
import { frameApplicabilityLabel, getFramePhotoIndexes, type BoothFrame } from '../../camera/boothFrames'
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
  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId) ?? null
  const noFrameSelected = selectedFrameId === null
  const hasSelection = noFrameSelected || Boolean(selectedFrame)
  const photoCount = experience === 'strip'
    ? selectedFrame ? getFramePhotoIndexes(selectedFrame).length || 3 : 3
    : 1
  const experienceName = experience === 'strip' ? 'PHOTO STRIP' : 'FOTO TUNGGAL'

  return (
    <section className="flow-page frame-selection-page">
      <div className="flow-heading frame-selection-heading">
        <div className="eyebrow">LANGKAH 04 · PILIH FRAME</div>
        <h2>Pilih tampilan fotomu.</h2>
        <p>{experience === 'single' ? 'Satu jepretan akan mengisi semua slot frame.' : 'Jumlah jepretan mengikuti foto sumber unik di frame.'} Pilih frame untuk melanjutkan.</p>
      </div>

      <div className="frame-selection-workspace">
        <div className="frame-showcase-column">
          <div className="frame-gallery-heading"><div><span>GALERI FRAME</span><small>{frames.length} desain tersedia untuk {experienceName.toLowerCase()}</small></div></div>
          {frames.length === 0
            ? <button className={`frame-gallery-card no-frame-choice ${noFrameSelected ? 'selected' : ''}`} type="button" aria-pressed={noFrameSelected} onClick={() => onSelectFrame(null)}>
              <span className="frame-gallery-art no-frame-art"><ImageIcon size={26} /></span>
              <span className="frame-gallery-info"><b>Tanpa frame</b><small>Gunakan hasil foto tanpa overlay.</small></span>
              <span className="frame-gallery-select">{noFrameSelected ? <><Check size={14} /> Dipilih</> : 'Pilih'}</span>
            </button>
            : <div className="frame-choice-grid">
              {frames.map((frame) => {
                const selected = selectedFrameId === frame.id
                const count = experience === 'strip' ? getFramePhotoIndexes(frame).length || 3 : 1
                return <button className={`frame-gallery-card ${selected ? 'selected' : ''}`} key={frame.id} type="button" aria-pressed={selected} onClick={() => onSelectFrame(frame.id)}>
                  <span className="frame-gallery-art"><img src={frame.dataUrl} alt={`Frame ${frame.name}`} /></span>
                  <span className="frame-gallery-info"><b>{frame.name}</b><small>{count} {experience === 'strip' ? 'pose' : 'jepretan'} · {frame.slots.length} area foto</small></span>
                  <span className="frame-gallery-select">{selected ? <><Check size={14} /> Dipilih</> : 'Pilih frame'}</span>
                </button>
              })}
            </div>}
        </div>

        <aside className="frame-session-sidebar">
          <section className="frame-feature-card">
            <div className="frame-feature-heading">
              <span>{selectedFrame ? 'PREVIEW FRAME' : noFrameSelected ? 'PILIHAN SESI' : 'PREVIEW FRAME'}</span>
              <b>{selectedFrame?.name ?? (noFrameSelected ? 'Tanpa frame' : 'Pilih frame')}</b>
              <small>{selectedFrame
                ? `${frameApplicabilityLabel(selectedFrame.appliesTo)} · ${selectedFrame.width} × ${selectedFrame.height} px`
                : noFrameSelected ? 'Foto tanpa overlay PNG.' : 'Semua desain tampil utuh dengan posisi slot fotonya.'}</small>
            </div>
            {selectedFrame
              ? <FrameSlotPreview frame={selectedFrame} experience={experience} />
              : noFrameSelected
                ? <div className="frame-feature-empty no-frame-feature"><ImageIcon size={34} /><b>Sesi tanpa frame</b><small>Hasil foto ditampilkan tanpa overlay PNG.</small></div>
                : <div className="frame-feature-empty"><ImageIcon size={30} /><b>Pilih desain dari galeri</b><small>Preview utuh dan posisi slot akan tampil di sini.</small></div>}
          </section>

          <section className="frame-session-summary">
            <div className="frame-summary-mode"><span>FORMAT SESI</span><b>{experienceName}</b></div>
            <div className="frame-summary-metrics">
              <div><span>FOTO DIAMBIL</span><b>{photoCount}</b><small>{experience === 'strip' ? 'pose' : 'jepretan'}</small></div>
              <div><span>SLOT FRAME</span><b>{selectedFrame?.slots.length ?? 0}</b><small>{selectedFrame ? 'area foto' : 'pilih frame'}</small></div>
            </div>
            {selectedFrame && <div className="frame-summary-selected"><span>FRAME</span><b>{selectedFrame.name}</b></div>}
          </section>
        </aside>
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
