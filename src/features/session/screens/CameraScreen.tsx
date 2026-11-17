import type { RefObject } from 'react'
import { ArrowRight, Camera, Check, RefreshCw, Sparkles } from 'lucide-react'
import type { Experience } from '../../../types/app'
import { PhotoIllustration } from '../../../components/shared/PhotoIllustration'

type CameraScreenProps = {
  experience: Experience
  shots: string[]
  shotLimit: number
  cameraStream: MediaStream | null
  cameraError: string
  countdown: number | null
  capturing: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  onCapture: () => void
  onRetake: () => void
  onContinue: () => void
}

export function CameraScreen({ experience, shots, shotLimit, cameraStream, cameraError, countdown, capturing, videoRef, onCapture, onRetake, onContinue }: CameraScreenProps) {
  return (
    <section className="flow-page camera-page">
      <div className="camera-heading"><div><div className="eyebrow">LANGKAH 02 â€” SAATNYA BERPOSE</div><h2>Siapkan senyum terbaikmu!</h2><p>{experience === 'strip' ? `Kita ambil ${shotLimit} pose yang berbeda, ya.` : 'Satu pose terbaikmu akan jadi kenangan.'}</p></div><div className="shot-progress">{Array.from({ length: shotLimit }).map((_, index) => <span key={index} className={index < shots.length ? 'done' : ''}>{index < shots.length ? <Check size={14} /> : `0${index + 1}`}</span>)}</div></div>
      <div className="camera-layout">
        <div className="camera-view">
          {cameraStream ? <video ref={videoRef} autoPlay playsInline muted className="camera-video" /> : <div className="camera-placeholder"><PhotoIllustration /><div className="placeholder-label"><Camera size={16} /> {cameraError || 'Menyiapkan kameraâ€¦'}</div></div>}
          <div className="camera-live-pill"><span className={cameraStream ? 'status-dot' : 'status-dot muted'} />{cameraStream ? 'KAMERA SIAP' : 'MODE DEMO'}</div>
          {countdown !== null && <div className="countdown-overlay"><span>{countdown}</span></div>}
          {!cameraStream && <div className="camera-tip"><Sparkles size={16} /> Posisikan dirimu di dalam frame</div>}
        </div>
        {cameraStream && cameraError && <div className="camera-settings-warning">{cameraError}</div>}
        <aside className="capture-panel">
          <div className="capture-panel-head"><span>SESI FOTO</span><span>{shots.length} / {shotLimit}</span></div>
          <div className="capture-thumbnails">{Array.from({ length: shotLimit }).map((_, index) => <div className={`capture-thumb ${shots[index] ? 'has-shot' : ''}`} key={index}>{shots[index] ? <img src={shots[index]} alt={`Foto ${index + 1}`} /> : <span>{String(index + 1).padStart(2, '0')}</span>}</div>)}</div>
          <p>{shots.length >= shotLimit ? 'Semua pose sudah siap. Lihat hasilmu!' : 'Tekan tombol saat kamu siap untuk berpose.'}</p>
          {shots.length < shotLimit ? <button className="shutter-button" onClick={onCapture} disabled={capturing}><span className="shutter-core" /><span>{capturing ? 'Bersiapâ€¦' : 'Ambil foto'}</span></button> : <button className="primary-cta compact result-cta" onClick={onContinue}><span>Lihat hasil foto</span><span className="cta-icon"><ArrowRight size={20} /></span></button>}
          <button className="retake-link" onClick={onRetake} disabled={shots.length === 0}><RefreshCw size={14} /> Ulangi semua foto</button>
        </aside>
      </div>
      <div className="flow-progress"><span className="active" /><span className="active" /><span /></div>
    </section>
  )
}
