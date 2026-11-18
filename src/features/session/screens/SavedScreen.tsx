import { ArrowRight, Check } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

type SavedScreenProps = {
  sessionCount: number
  deliveryStatus: string
  driveLink: string
  onHome: () => void
}

export function SavedScreen({ sessionCount, deliveryStatus, driveLink, onHome }: SavedScreenProps) {
  return (
    <section className="saved-page">
      <div className={`saved-content ${driveLink ? 'has-drive' : 'no-drive'}`}>
        <div className="saved-thanks">
          <div className="saved-icon"><Check size={39} /></div>
          <div className="eyebrow">MOMENMU SUDAH TERSIMPAN</div>
          <h2>Terima kasih sudah<br />berfoto bersama kami!</h2>
          <p>Foto kamu sedang disiapkan untuk dicetak. Sampai jumpa lagi ✿</p>
          {deliveryStatus && <p className="saved-delivery-status">{deliveryStatus}</p>}
          <div className="saved-ticket"><span>SESI FOTO</span><b>#{String(sessionCount).padStart(4, '0')}</b><i /><span>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</span></div>
          <button className="primary-cta compact" onClick={onHome}><span>Kembali ke menu utama</span><span className="cta-icon"><ArrowRight size={20} /></span></button>
        </div>
        {driveLink && <div className="saved-drive-card">
          <div className="eyebrow">FOTO SIAP DIUNDUH</div>
          <div className="saved-drive-qr"><QRCodeSVG value={driveLink} size={220} level="M" title="QR code untuk membuka folder foto di Google Drive" /></div>
          <b>Pindai untuk membuka semua foto</b>
          <p>Folder Google Drive berisi hasil foto, foto asli, dan Boomerang GIF.</p>
          <small>Siapa pun yang memiliki link ini dapat melihat foto. Link tidak kedaluwarsa otomatis.</small>
        </div>}
      </div>
    </section>
  )
}
