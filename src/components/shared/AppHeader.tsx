import { ArrowLeft } from 'lucide-react'
import { BrandMark } from './BrandMark'
import type { Screen } from '../../types/app'

type AppHeaderProps = {
  screen: Screen
  onHome: () => void
  onBack: () => void
}

export function AppHeader({ screen, onHome, onBack }: AppHeaderProps) {
  return (
    <header className="topbar">
      <button className="brand-button" onClick={onHome} aria-label="Kembali ke menu utama">
        <BrandMark small />
        <span className="brand-wordmark"><b>CAPTURS</b><small>PHOTOBOOTH</small></span>
      </button>
      <div className="booth-status"><span className="status-dot" /> Booth beroperasi <i /> <span>Jakarta</span></div>
      {screen === 'home'
        ? <div className="top-date"><span>HARI INI</span><b>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date())}</b></div>
        : <button className="top-back" onClick={onBack}><ArrowLeft size={17} /> Kembali</button>}
    </header>
  )
}
