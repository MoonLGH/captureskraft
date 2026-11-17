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
      <button className="brand-button" onClick={onHome} aria-label="Kembali ke menu utama">
        <BrandMark small />
        <span className="brand-wordmark"><b>CAPTURS</b><small>PHOTOBOOTH</small></span>
      </button>
      <span className="booth-status" title={boothName || 'Capturs Photobooth'}>{boothName || 'Capturs Photobooth'}</span>
      {screen === 'home'
        ? <time className="top-date"><span>HARI INI</span><b>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date())}</b></time>
        : <button className="top-back" onClick={onBack}><ArrowLeft size={17} /> Kembali</button>}
    </header>
  )
}
