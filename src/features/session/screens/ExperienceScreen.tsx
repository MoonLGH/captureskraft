import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import type { Experience } from '../../../types/app'
import { money } from '../../../utils/format'

type ExperienceScreenProps = {
  experience: Experience
  price: string
  paymentCoveredByEvent: boolean
  onSelectExperience: (experience: Experience) => void
  onBack: () => void
  onContinue: () => void
}

export function ExperienceScreen({ experience, price, paymentCoveredByEvent, onSelectExperience, onBack, onContinue }: ExperienceScreenProps) {
  const basePrice = Number(price) || 35000

  return (
    <section className="flow-page">
      <div className="flow-heading"><div className="eyebrow">LANGKAH 01 — PILIH FORMAT</div><h2>Mau foto yang mana?</h2><p>Semua pose kamu akan kami simpan jadi kenangan.</p></div>
      <div className="experience-grid">
        <button className={`experience-card ${experience === 'strip' ? 'selected' : ''}`} onClick={() => onSelectExperience('strip')}>
          <span className="select-check">{experience === 'strip' && <Check size={15} />}</span>
          <div className="strip-art"><span /><span /><span /></div>
          <span className="experience-info"><b>Photo strip</b><small>Pilih frame dan jumlah pose di langkah berikutnya</small></span><span className="experience-price">{paymentCoveredByEvent ? 'Dibayar acara' : money(basePrice)}</span>
        </button>
        <button className={`experience-card ${experience === 'single' ? 'selected' : ''}`} onClick={() => onSelectExperience('single')}>
          <span className="select-check">{experience === 'single' && <Check size={15} />}</span>
          <div className="single-art"><div><span /></div></div>
          <span className="experience-info"><b>Foto tunggal</b><small>1 pose · cetak ukuran besar</small></span><span className="experience-price">{paymentCoveredByEvent ? 'Dibayar acara' : money(Math.round(basePrice * 0.7))}</span>
        </button>
      </div>
      <div className="flow-actions"><button className="soft-button" onClick={onBack}><ArrowLeft size={18} /> Kembali</button><button className="primary-cta compact" onClick={onContinue}><span>Pilih frame</span><span className="cta-icon"><ArrowRight size={20} /></span></button></div>
      <div className="flow-progress"><span className="active" /><span /><span /><span /><span /></div>
    </section>
  )
}
