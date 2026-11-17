import { ArrowRight, Camera, CheckCircle2, Image, Sparkles } from 'lucide-react'
import { PhotoIllustration } from '../../../components/shared/PhotoIllustration'
import { money } from '../../../utils/format'

type HomeScreenProps = {
  price: string
  onBeginSession: () => void
}

export function HomeScreen({ price, onBeginSession }: HomeScreenProps) {
  const formattedPrice = money(Number(price) || 35000)

  return (
    <section className="home-layout">
      <div className="home-copy">
        <div className="eyebrow"><Sparkles size={14} fill="currentColor" /> KENANGAN KECIL, CERITA BESAR</div>
        <h1>Hari ini layak<br />jadi <em>kenangan.</em></h1>
        <p className="home-description">Ajak temanmu, pilih gaya foto, dan pulang dengan momen yang bisa disimpan selamanya.</p>
        <button className="primary-cta" onClick={onBeginSession}><span>Mulai sesi foto</span><span className="cta-icon"><ArrowRight size={22} /></span></button>
        <div className="home-meta"><span><CheckCircle2 size={17} /> Cepat & mudah</span><span><CheckCircle2 size={17} /> Hasil langsung dicetak</span></div>
        <div className="session-price"><div className="price-icon"><Image size={19} /></div><div><span>SESI FOTO MULAI DARI</span><b>{formattedPrice}</b></div><span className="price-note">3 foto Â· 1 strip</span></div>
      </div>
      <div className="home-visual">
        <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
        <div className="photo-card"><PhotoIllustration /><div className="photo-caption"><div><span>CAPTURS MOMENT</span><b>Besties, always âœ¿</b></div><span className="photo-number">01 / 03</span></div></div>
        <div className="floating-note note-top"><span className="note-spark">âœ³</span><span><b>Good times</b><small>are made together</small></span></div>
        <div className="floating-note note-bottom"><span className="note-camera"><Camera size={17} /></span><span><b>Pose sesukamu</b><small>kami yang urus sisanya</small></span></div>
        <span className="doodle doodle-a">âœ³</span><span className="doodle doodle-b">âœ¦</span>
      </div>
      <div className="home-footer"><span>Setiap frame, satu cerita baru.</span><span className="home-footer-right"><span className="little-stars">âœ¦ âœ¦ âœ¦</span> CAPTURS PHOTOBOOTH</span></div>
    </section>
  )
}
