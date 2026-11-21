import { ArrowLeft } from 'lucide-react'
import { BrandMark } from './BrandMark'
import type { Screen } from '../../types/app'

type AppHeaderProps = {
  screen: Screen
  boothName: string
  sessionRemainingMs?: number | null
  onHome: () => void
  onBack: () => void
}

export function AppHeader({ screen, boothName, sessionRemainingMs = null, onHome, onBack }: AppHeaderProps) {
  const totalSeconds = Math.max(0, Math.ceil((sessionRemainingMs ?? 0) / 1000))
  const remainingTime = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
  return (
    <header className="topbar">
      {screen !== 'home' && screen !== 'customer' && screen !== 'frameSelect' && screen !== 'payment' && <button className="top-back" onClick={onBack}><ArrowLeft size={17} /> Kembali</button>}
      <span className="booth-status" title={boothName || 'Capturs Photobooth'}>{boothName || 'Capturs Photobooth'}</span>
      {sessionRemainingMs !== null && <span className="session-countdown" role="timer" aria-label={`Waktu sesi tersisa ${remainingTime}`}><small>SISA WAKTU</small><b>{remainingTime}</b></span>}
      <time className="top-date"><span>HARI INI</span><b>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date())}</b></time>
      <button className="brand-button" onClick={onHome} disabled={screen === 'frameSelect'} aria-label={screen === 'frameSelect' ? 'Capturs Photobooth' : 'Kembali ke menu utama'}>
        <BrandMark small />
        <span className="brand-wordmark"><b>CAPTURS</b><small>PHOTOBOOTH</small></span>
      </button>
    </header>
  )
}
