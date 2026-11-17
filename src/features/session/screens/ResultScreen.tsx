import { useEffect, useState } from 'react'
import { ArrowRight, Printer, RefreshCw, Sparkles } from 'lucide-react'
import { composeFrame } from '../../camera/composeFrame'
import type { BoothFrame } from '../../camera/boothFrames'
import type { Experience } from '../../../types/app'

type ResultScreenProps = {
  experience: Experience
  shots: string[]
  frame: BoothFrame | null
  onRetake: () => void
  onFinish: () => void
}

export function ResultScreen({ experience, shots, frame, onRetake, onFinish }: ResultScreenProps) {
  const [framedResult, setFramedResult] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [compositionError, setCompositionError] = useState('')

  useEffect(() => {
    let active = true
    setFramedResult('')
    setCompositionError('')
    if (!frame?.slots.length) {
      setIsComposing(false)
      return
    }
    setIsComposing(true)
    void composeFrame(shots, frame).then((result) => {
      if (active) setFramedResult(result)
    }).catch(() => {
      if (active) setCompositionError('Frame tidak dapat diterapkan. Foto tetap tersedia di bawah.')
    }).finally(() => {
      if (active) setIsComposing(false)
    })
    return () => { active = false }
  }, [frame, shots])

  return (
    <section className="flow-page result-page">
      <div className="result-heading"><span className="success-badge"><Sparkles size={17} /> HASIL FOTO SIAP</span><h2>Lucu banget! âœ¨</h2><p>Pilih simpan untuk melanjutkan ke proses cetak.</p></div>
      {isComposing
        ? <div className="frame-composition-status">Menyusun foto ke dalam frame…</div>
        : framedResult
        ? <div className="framed-result-preview"><img src={framedResult} alt="Hasil foto dengan custom frame" /></div>
        : <div className={`result-strip ${experience === 'single' ? 'single-result' : ''}`}>
          {shots.map((shot, index) => <div className="result-photo" key={`${index}-${shot.slice(-10)}`}><img src={shot} alt={`Hasil foto ${index + 1}`} /><span>CAPTURS Â· {String(index + 1).padStart(2, '0')}</span></div>)}
          <span className="result-brand">CAPTURS PHOTOBOOTH Â· JAKARTA</span>
        </div>}
      {compositionError && <div className="frame-composition-error">{compositionError}</div>}
      <div className="result-actions"><button className="soft-button" onClick={onRetake}><RefreshCw size={17} /> Foto ulang</button><button className="primary-cta compact" onClick={onFinish} disabled={isComposing}><span>{isComposing ? 'Menyusun hasil…' : 'Simpan & cetak foto'}</span><span className="cta-icon"><Printer size={20} /></span></button></div>
      <div className="print-note"><Printer size={15} /> Printer akan mulai setelah sesi tersimpan.</div>
    </section>
  )
}
