import { useState, type RefObject } from 'react'
import { ArrowRight, Camera, Check, RefreshCw } from 'lucide-react'
import type { Experience } from '../../../types/app'
import { PhotoIllustration } from '../../../components/shared/PhotoIllustration'
import type { BoothFrame } from '../../camera/boothFrames'
import { LiveFrameCompositionPreview } from '../components/LiveFrameCompositionPreview'
import { cameraPreviewCss, DEFAULT_SESSION_CAMERA_SETTINGS, type SessionCameraSettings } from '../../camera/cameraEffects'

type CameraScreenProps = {
  experience: Experience
  frame: BoothFrame | null
  shots: string[]
  shotLimit: number
  cameraStream: MediaStream | null
  cameraError: string
  countdown: number | null
  advanceCountdown: number | null
  recordingSeconds: number | null
  retakeIndex: number | null
  reviewIndex: number | null
  capturing: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  cameraSettings?: SessionCameraSettings
  onCapture: () => void
  onRetakeShot: (index: number) => void
  onRetake: () => void
  onContinue: () => void
}

export function CameraScreen({ experience, frame, shots, shotLimit, cameraStream, cameraError, countdown, advanceCountdown, recordingSeconds, retakeIndex, reviewIndex, capturing, videoRef, cameraSettings = DEFAULT_SESSION_CAMERA_SETTINGS, onCapture, onRetakeShot, onRetake, onContinue }: CameraScreenProps) {
  const [framePreviewWidth, setFramePreviewWidth] = useState(0)
  const isReviewingShot = advanceCountdown !== null && reviewIndex !== null
  const nextShotLabel = `Ambil foto ${shots.length + 1}`
  const sessionComplete = shots.length >= shotLimit && !isReviewingShot
  const shutterLabel = capturing
    ? retakeIndex !== null ? `Mengulang foto ${retakeIndex + 1}…` : `Mengambil foto ${shots.length + 1}…`
    : isReviewingShot ? `Ambil ulang foto ${reviewIndex + 1}` : nextShotLabel
  const statusTitle = recordingSeconds !== null
    ? 'LIVE PHOTO SEDANG DIREKAM'
    : capturing
    ? shutterLabel
    : isReviewingShot ? `Ambil ulang foto ${reviewIndex + 1}?` : null
  const statusCountdown = recordingSeconds ?? countdown ?? (isReviewingShot ? advanceCountdown : null)

  return (
    <section className="camera-page">
      <div className="camera-layout">
        <div className="camera-view">
          {cameraStream
            ? <video ref={videoRef} autoPlay playsInline muted className="camera-video" style={{ filter: cameraPreviewCss(cameraSettings) }} />
            : <div className="camera-placeholder"><PhotoIllustration /><div className="placeholder-label"><Camera size={16} /> {cameraError || 'Menyiapkan kamera…'}</div></div>}
          {statusTitle && <div className="countdown-overlay" aria-live="polite" aria-atomic="true">
            <div className="camera-status-title">{statusTitle}</div>
            {statusCountdown !== null && <strong className="camera-countdown-number">{statusCountdown}</strong>}
            {recordingSeconds !== null && <div className="camera-status-hint">rekaman Live Photo 3 detik</div>}
            {isReviewingShot && <div className="camera-status-hint">tekan shutter button untuk retake</div>}
          </div>}
        </div>

        <header className="camera-heading camera-floating-heading">
          <div className="shot-progress" style={framePreviewWidth > 0 && frame?.slots.length ? { width: `${framePreviewWidth}px` } : undefined} aria-label={`${shots.length} dari ${shotLimit} foto diambil`}>
            {Array.from({ length: shotLimit }).map((_, index) => <span key={index} className={index < shots.length ? 'done' : ''}>{index < shots.length ? <Check size={14} /> : `0${index + 1}`}</span>)}
          </div>
        </header>

        {cameraStream && cameraError && <div className="camera-settings-warning">{cameraError}</div>}

        <div className="camera-control-stack">
          {frame && frame.slots.length > 0 && <aside className="camera-frame-composition" style={framePreviewWidth > 0 ? { width: `${framePreviewWidth}px` } : undefined}>
            <LiveFrameCompositionPreview frame={frame} shots={shots} experience={experience} videoRef={videoRef} retakePhotoIndex={retakeIndex} onPreviewWidthChange={setFramePreviewWidth} cameraSettings={cameraSettings} />
          </aside>}

          <aside className={`capture-panel ${sessionComplete ? 'capture-panel-complete' : ''}`}>
            <div className="capture-panel-head"><span>SESI FOTO</span><span>{shots.length} / {shotLimit}</span></div>
            {isReviewingShot || shots.length < shotLimit
              ? <button className="shutter-button" aria-label={shutterLabel} title={shutterLabel} onClick={() => { if (isReviewingShot && reviewIndex !== null) onRetakeShot(reviewIndex); else onCapture() }} disabled={capturing || countdown !== null}><span className="shutter-core" /></button>
              : <button className="primary-cta compact result-cta" onClick={onContinue}><span>Lihat hasil foto</span><span className="cta-icon"><ArrowRight size={20} /></span></button>}
            <button className="retake-link" onClick={onRetake} disabled={shots.length === 0 || capturing || countdown !== null}><RefreshCw size={14} /> Ulangi semua foto</button>
          </aside>
        </div>

        <div className="flow-progress camera-flow-progress"><span className="active" /><span className="active" /><span className="active" /><span className="active" /><span className="active" /><span className="active" /></div>
      </div>
    </section>
  )
}
