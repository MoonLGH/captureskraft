import { ArrowLeft, ArrowRight, Check, Sparkles, WandSparkles } from 'lucide-react'
import type { RefObject } from 'react'
import type { SessionCameraSettings } from '../../camera/cameraEffects'
import { cameraPreviewCss, PHOTO_FILTERS } from '../../camera/cameraEffects'

type CameraSettingsScreenProps = {
  settings: SessionCameraSettings
  cameraStream: MediaStream | null
  cameraError: string
  videoRef: RefObject<HTMLVideoElement | null>
  onChange: (settings: SessionCameraSettings) => void
  onBack: () => void
  onContinue: () => void
}

export function CameraSettingsScreen({ settings, cameraStream, cameraError, videoRef, onChange, onBack, onContinue }: CameraSettingsScreenProps) {
  const toggle = (key: 'smoothSkin' | 'retouch') => onChange({ ...settings, [key]: !settings[key] })
  const activeFilter = PHOTO_FILTERS.find((filter) => filter.id === settings.filter)

  return <section className="flow-page camera-session-settings-page">
    <div className="flow-heading">
      <div className="eyebrow">PENGATURAN SESI</div>
      <h2>Atur gaya fotomu.</h2>
      <p>Pilih filter dan sentuhan beauty untuk semua foto di sesi ini.</p>
    </div>

    <div className="session-camera-settings-workspace">
      <div className="session-camera-preview-card admin-card">
        <div className="session-camera-preview-label"><span><span className="session-live-indicator" /> PREVIEW KAMERA</span><b>{activeFilter?.name ?? 'Natural'}</b></div>
        <div className="session-camera-preview-window">
          {cameraStream
            ? <video ref={videoRef} autoPlay playsInline muted style={{ filter: cameraPreviewCss(settings) }} />
            : <div className="session-camera-preview-empty"><span className="session-setting-icon"><Sparkles size={18} /></span><b>{cameraError || 'Menyiapkan preview kamera…'}</b><small>Filter akan terlihat langsung saat kamera siap.</small></div>}
          {cameraStream && <span className="session-camera-preview-tag">LIVE</span>}
        </div>
      </div>

      <div className="session-camera-settings-card admin-card">
        <div className="session-setting-section">
          <div className="session-setting-heading"><span className="session-setting-icon"><Sparkles size={17} /></span><div><b>Filter warna</b><small>Pilih palet yang akan dipakai di hasil foto.</small></div></div>
          <div className="session-filter-grid" role="group" aria-label="Filter warna foto">
            {PHOTO_FILTERS.map((filter) => <button
              className={`session-filter-option ${settings.filter === filter.id ? 'selected' : ''}`}
              key={filter.id}
              type="button"
              aria-pressed={settings.filter === filter.id}
              onClick={() => onChange({ ...settings, filter: filter.id })}
            >
              <span className="session-filter-swatch" style={{ background: filter.swatch }}><span className={`session-filter-sample filter-${filter.id}`} style={{ filter: filter.css }} /></span>
              <span className="session-filter-copy"><b>{filter.name}</b><small>{filter.description}</small></span>
              {settings.filter === filter.id && <span className="session-filter-check"><Check size={13} /></span>}
            </button>)}
          </div>
        </div>

        <div className="session-setting-section beauty-setting-section">
          <div className="session-setting-heading"><span className="session-setting-icon"><WandSparkles size={17} /></span><div><b>Beauty mode</b><small>Efek ringan, bisa diaktifkan atau dimatikan kapan saja.</small></div></div>
          <div className="beauty-toggle-list">
            <button type="button" className={`beauty-toggle-row ${settings.smoothSkin ? 'enabled' : ''}`} aria-pressed={settings.smoothSkin} onClick={() => toggle('smoothSkin')}>
              <span className="beauty-toggle-copy"><b>Smooth Skin</b><small>Melembutkan tampilan kulit secara halus.</small></span>
              <span className="beauty-switch" aria-hidden="true"><span /></span>
            </button>
            <button type="button" className={`beauty-toggle-row ${settings.retouch ? 'enabled' : ''}`} aria-pressed={settings.retouch} onClick={() => toggle('retouch')}>
              <span className="beauty-toggle-copy"><b>Retouch</b><small>Menambah sentuhan cerah dan lembut pada foto.</small></span>
              <span className="beauty-switch" aria-hidden="true"><span /></span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div className="flow-actions camera-session-settings-actions">
      <button className="soft-button" type="button" onClick={onBack}><ArrowLeft size={18} /> Kembali</button>
      <button className="primary-cta compact" type="button" onClick={onContinue}><span>Mulai foto</span><span className="cta-icon"><ArrowRight size={20} /></span></button>
    </div>
    <div className="flow-progress"><span className="active" /><span className="active" /><span className="active" /><span className="active" /><span className="active" /><span /></div>
  </section>
}
