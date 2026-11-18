import { ArrowLeft } from 'lucide-react'
import { BrandMark } from './BrandMark'
import type { Screen } from '../../types/app'

type AppHeaderProps = {
  screen: Screen
  boothName: string
  onHome: () => void
  onBack: () => void
}

export function AppHeader({ screen, boothName, onHome, onBack }: AppHeaderProps) {
  return (
    <header className="topbar">
      {screen !== 'home' && screen !== 'customer' && <button className="top-back" onClick={onBack}><ArrowLeft size={17} /> Kembali</button>}
      <span className="booth-status" title={boothName || 'Capturs Photobooth'}>{boothName || 'Capturs Photobooth'}</span>
      <time className="top-date"><span>HARI INI</span><b>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date())}</b></time>
      <button className="brand-button" onClick={onHome} aria-label="Kembali ke menu utama">
        <BrandMark small />
        <span className="brand-wordmark"><b>CAPTURS</b><small>PHOTOBOOTH</small></span>
      </button>
    </header>
  )
}
