import { ArrowRight, Check } from 'lucide-react'

type SavedScreenProps = {
  sessionCount: number
  deliveryStatus: string
  onHome: () => void
}

export function SavedScreen({ sessionCount, deliveryStatus, onHome }: SavedScreenProps) {
  return (
    <section className="saved-page">
      <div className="saved-icon"><Check size={39} /></div>
      <div className="eyebrow">MOMENMU SUDAH TERSIMPAN</div>
      <h2>Terima kasih sudah<br />berfoto bersama kami!</h2>
      <p>Foto kamu sedang disiapkan untuk dicetak. Sampai jumpa lagi ✿</p>
      {deliveryStatus && <p className="saved-delivery-status">{deliveryStatus}</p>}
      <div className="saved-ticket"><span>SESI FOTO</span><b>#{String(sessionCount).padStart(4, '0')}</b><i /><span>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</span></div>
      <button className="primary-cta compact" onClick={onHome}><span>Kembali ke menu utama</span><span className="cta-icon"><ArrowRight size={20} /></span></button>
    </section>
  )
}
