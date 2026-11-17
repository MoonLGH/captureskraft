import { ArrowRight } from 'lucide-react'

type HomeScreenProps = {
  boothName: string
  onBeginSession: () => void
}

export function HomeScreen({ boothName, onBeginSession }: HomeScreenProps) {
  return (
    <section className="home-layout">
      <div className="home-copy">
        <div className="home-eyebrow">{boothName || 'Capturs Photobooth'}</div>
        <h1>Momen seru<br />mulai <em>di sini.</em></h1>
        <p className="home-description">Pilih frame favorit, ajak temanmu, lalu bawa pulang kenangan yang langsung dicetak.</p>
        <div className="home-actions">
          <button className="primary-cta" onClick={onBeginSession}><span>Mulai sesi foto</span><span className="cta-icon"><ArrowRight size={21} /></span></button>
        </div>
      </div>

      <footer className="home-footer"><span>Kenangan kecil, cerita besar.</span><span>CAPTURS <i /> PHOTOBOOTH</span></footer>
    </section>
  )
}
