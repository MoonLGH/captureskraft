import { useEffect, useRef, useState } from 'react'
import { Camera, RefreshCw, Save, SlidersHorizontal } from 'lucide-react'
import { cameraTrackConstraints, NUMERIC_CAMERA_CONTROLS, type CameraControlKey, type CameraControlValues, type CameraSettings } from './cameraSettings'

type CameraDevice = { deviceId: string; label: string }
type NumericControl = { key: CameraControlKey; label: string; min: number; max: number; step: number; value: number; unit: string }
type ChoiceControl = { key: CameraControlKey; label: string; value: string; choices: string[] }
type CameraSettingsPanelProps = { settings: CameraSettings; onChange: (settings: CameraSettings) => void; onSave: () => void }

const CONTROL_LABELS: Partial<Record<CameraControlKey, string>> = {
  exposureMode: 'Mode exposure',
  whiteBalanceMode: 'Mode white balance',
  focusMode: 'Mode focus',
}

const CONTROL_KEYS = [
  ...NUMERIC_CAMERA_CONTROLS.map(({ key }) => key),
  'exposureMode', 'whiteBalanceMode', 'focusMode',
] as CameraControlKey[]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function formatValue(value: number, unit: string) {
  const formatted = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
  return unit === 's' ? `${formatted} s` : unit === 'm' ? `${formatted} m` : unit ? `${formatted} ${unit}` : formatted
}

export function CameraSettingsPanel({ settings, onChange, onSave }: CameraSettingsPanelProps) {
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const constraintQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [numericControls, setNumericControls] = useState<NumericControl[]>([])
  const [choiceControls, setChoiceControls] = useState<ChoiceControl[]>([])
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewControlMessage, setPreviewControlMessage] = useState('')
  const [applyingPreviewControls, setApplyingPreviewControls] = useState(false)
  const [deviceError, setDeviceError] = useState('')
  const [capabilityMessage, setCapabilityMessage] = useState('Klik “Baca kontrol kamera” untuk melihat ISO, exposure, dan kontrol lain yang tersedia.')
  const [reading, setReading] = useState(false)

  const enumerateCameras = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDeviceError('Daftar kamera tidak tersedia pada mode preview ini.')
      return
    }
    try {
      const available = await navigator.mediaDevices.enumerateDevices()
      const cameras = available.filter((device) => device.kind === 'videoinput').map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Kamera ${index + 1}`,
      }))
      setDevices(cameras)
      setDeviceError(cameras.length ? '' : 'Belum ada kamera yang terdeteksi. Izinkan akses kamera lalu muat ulang daftar.')
    } catch {
      setDeviceError('Tidak dapat membaca daftar kamera.')
    }
  }

  const readCapabilities = async (deviceId = settings.cameraDeviceId) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCapabilityMessage('Kontrol kamera tidak tersedia pada mode preview ini.')
      return
    }
    setReading(true)
    setNumericControls([])
    setChoiceControls([])
    let stream: MediaStream | null = null
    try {
      let track = previewStream?.getVideoTracks().find((item) => item.readyState === 'live')
      if (!track || deviceId !== settings.cameraDeviceId) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' },
          audio: false,
        })
        track = stream.getVideoTracks()[0]
      }
      if (!track) throw new Error('Track kamera tidak tersedia.')
      const capabilities = asRecord(track && 'getCapabilities' in track ? track.getCapabilities() : {})
      const actualSettings = asRecord(track?.getSettings())
      const numeric: NumericControl[] = []
      const choices: ChoiceControl[] = []

      for (const definition of NUMERIC_CAMERA_CONTROLS) {
        const range = asRecord(capabilities[definition.key])
        const min = typeof range.min === 'number' ? range.min : undefined
        const max = typeof range.max === 'number' ? range.max : undefined
        if (min === undefined || max === undefined || max < min) continue
        const step = typeof range.step === 'number' && range.step > 0 ? range.step : 1
        const current = settings.controls[definition.key]
        const actual = actualSettings[definition.key]
        const value = typeof current === 'number' ? current : typeof actual === 'number' ? actual : min
        numeric.push({ key: definition.key, label: definition.label, min, max, step, value: Math.min(max, Math.max(min, value)), unit: definition.unit })
      }

      for (const key of CONTROL_KEYS.slice(NUMERIC_CAMERA_CONTROLS.length)) {
        const available = capabilities[key]
        if (!Array.isArray(available) || !available.length) continue
        const options = available.filter((item): item is string => typeof item === 'string')
        if (!options.length) continue
        const current = settings.controls[key]
        const actual = actualSettings[key]
        const value = typeof current === 'string' && options.includes(current)
          ? current
          : typeof actual === 'string' && options.includes(actual) ? actual : options[0]
        choices.push({ key, label: CONTROL_LABELS[key] ?? key, value, choices: options })
      }

      setNumericControls(numeric)
      setChoiceControls(choices)
      const supportedCount = numeric.length + choices.length
      setCapabilityMessage(supportedCount
        ? `${track.label || 'Kamera terpilih'} menyediakan ${supportedCount} kontrol manual. Perubahan akan diterapkan langsung ke preview jika didukung kamera.`
        : `${track.label || 'Kamera terpilih'} tidak melaporkan kontrol manual. Beberapa webcam hanya menyediakan pengaturan otomatis.`)
      setDeviceError('')
      await enumerateCameras()
    } catch {
      setCapabilityMessage('Akses kamera gagal. Izinkan akses kamera di sistem, lalu coba baca kontrol lagi.')
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
      setReading(false)
    }
  }

  useEffect(() => {
    void enumerateCameras()
    const onDeviceChange = () => { void enumerateCameras() }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
  }, [])

  useEffect(() => {
    let active = true
    let stream: MediaStream | null = null
    setPreviewStream(null)
    setPreviewError('')
    setPreviewControlMessage('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setPreviewError('Preview kamera tidak tersedia pada perangkat ini.')
      return
    }

    const video: MediaTrackConstraints = settings.cameraDeviceId
      ? { deviceId: { exact: settings.cameraDeviceId } }
      : { facingMode: 'user' }
    void navigator.mediaDevices.getUserMedia({ video, audio: false }).then((openedStream) => {
      stream = openedStream
      if (!active) {
        openedStream.getTracks().forEach((track) => track.stop())
        return
      }
      setPreviewStream(openedStream)
      void enumerateCameras()
    }).catch(() => {
      if (active) setPreviewError(settings.cameraDeviceId
        ? 'Kamera terpilih tidak dapat dibuka. Periksa koneksi atau izin kamera.'
        : 'Tidak dapat membuka kamera. Periksa izin kamera di sistem.')
    })

    return () => {
      active = false
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [settings.cameraDeviceId])

  useEffect(() => {
    const video = previewVideoRef.current
    if (!video) return
    video.srcObject = previewStream
    if (previewStream) void video.play().catch(() => undefined)
  }, [previewStream])

  useEffect(() => {
    const track = previewStream?.getVideoTracks().find((item) => item.readyState === 'live')
    if (!track) return
    let active = true
    setApplyingPreviewControls(true)
    const timer = window.setTimeout(() => {
      constraintQueueRef.current = constraintQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (!active || track.readyState !== 'live') return
          await track.applyConstraints(cameraTrackConstraints(settings))
        })
        .then(() => {
          if (!active) return
          setApplyingPreviewControls(false)
          setPreviewControlMessage(Object.keys(settings.controls).length
            ? 'Kontrol diterapkan ke preview kamera.'
            : 'Mode otomatis aktif pada preview kamera.')
        })
        .catch(() => {
          if (!active) return
          setApplyingPreviewControls(false)
          setPreviewControlMessage('Preview aktif, tetapi sebagian kontrol tidak dapat diterapkan kamera.')
        })
    }, 140)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [previewStream, settings.controls])

  const changeDevice = (deviceId: string) => {
    const device = devices.find((item) => item.deviceId === deviceId)
    onChange({ ...settings, cameraDeviceId: deviceId, cameraDeviceLabel: device?.label ?? '', controls: {} })
    setNumericControls([])
    setChoiceControls([])
    setCapabilityMessage('Baca kontrol kamera pilihan ini untuk mengetahui rentang manual yang tersedia.')
    setDeviceError('')
  }

  const updateControl = (key: CameraControlKey, value: number | string) => {
    const controls: CameraControlValues = { ...settings.controls, [key]: value }
    onChange({ ...settings, controls })
  }

  return (
    <section className="camera-settings-panel">
      <div className="admin-title-row">
        <div><div className="eyebrow">PENGATURAN PERANGKAT</div><h2>Camera Settings</h2><p>Pilih kamera dan atur kontrol manual yang benar-benar didukung perangkat tersebut.</p></div>
        <button className="save-button" type="button" onClick={onSave}><Save size={16} /> Simpan perubahan</button>
      </div>

      <div className="camera-settings-grid">
        <section className="admin-card camera-preview-card">
          <div className="camera-preview-heading">
            <div className="camera-settings-card-title"><span className="config-icon blue-config-icon"><Camera size={19} /></span><div><b>Live camera preview</b><small>Perubahan kontrol kamera akan terlihat di sini jika didukung perangkat.</small></div></div>
            <span className={`camera-preview-status ${previewStream ? 'active' : previewError ? 'error' : ''}`}><i />{previewError ? 'Kamera tidak terhubung' : applyingPreviewControls ? 'Menerapkan setting' : previewStream ? 'Preview aktif' : 'Menyiapkan preview'}</span>
          </div>
          <div className="camera-preview-screen">
            <video ref={previewVideoRef} autoPlay muted playsInline aria-label="Preview kamera langsung" />
            {!previewStream && <div className="camera-preview-overlay"><Camera size={23} /><span>{previewError || 'Menghubungkan ke kamera…'}</span></div>}
          </div>
          <div className="camera-preview-caption"><span>{settings.cameraDeviceLabel || devices.find((device) => device.deviceId === settings.cameraDeviceId)?.label || 'Kamera default'}</span><small>{previewControlMessage || 'Preview berhenti saat keluar dari Camera Settings.'}</small></div>
        </section>

        <section className="admin-card camera-device-card">
          <div className="camera-settings-card-title"><span className="config-icon blue-config-icon"><Camera size={19} /></span><div><b>Perangkat kamera</b><span>Pilihan kamera hanya berlaku pada booth ini.</span></div></div>
          <label className="input-label" htmlFor="camera-device">Kamera yang digunakan</label>
          <select className="admin-input" id="camera-device" value={settings.cameraDeviceId} onChange={(event) => changeDevice(event.target.value)}>
            <option value="">Kamera bawaan / default</option>
            {settings.cameraDeviceId && !devices.some((device) => device.deviceId === settings.cameraDeviceId) && <option value={settings.cameraDeviceId}>{settings.cameraDeviceLabel || 'Kamera tersimpan (offline)'}</option>}
            {devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label}</option>)}
          </select>
          <div className="camera-device-actions">
            <button className="soft-button" type="button" onClick={() => { void enumerateCameras() }}><RefreshCw size={15} /> Muat ulang daftar</button>
            <button className="soft-button" type="button" disabled={reading} onClick={() => { void readCapabilities() }}><SlidersHorizontal size={15} /> {reading ? 'Membaca…' : 'Baca kontrol kamera'}</button>
          </div>
          {deviceError && <small className="field-help">{deviceError}</small>}
          <div className="connector-note"><span className="note-info">i</span><span>ISO, shutter, focus, dan kontrol lainnya bergantung pada kemampuan kamera. Jika kontrol tidak tersedia, aplikasi membiarkannya otomatis.</span></div>
        </section>

        <section className="admin-card camera-controls-card">
          <div className="camera-controls-heading"><div className="camera-settings-card-title"><span className="config-icon mongo-icon"><SlidersHorizontal size={19} /></span><div><b>Kontrol kamera</b><span>Rentang diambil langsung dari kamera yang dipilih.</span></div></div><button className="soft-button" type="button" disabled={!Object.keys(settings.controls).length} onClick={() => { onChange({ ...settings, controls: {} }); setNumericControls([]); setChoiceControls([]); setCapabilityMessage('Kontrol direset ke otomatis. Baca ulang kontrol untuk menyetel kamera lagi.') }}>Reset otomatis</button></div>
          <p className="camera-capability-message">{capabilityMessage}</p>
          {numericControls.length > 0 && <div className="camera-control-grid">{numericControls.map((control) => {
            const rawValue = typeof settings.controls[control.key] === 'number' ? settings.controls[control.key] as number : control.value
            const value = Math.min(control.max, Math.max(control.min, rawValue))
            return <label className="camera-control" key={control.key}>
              <span><b>{control.label}</b><small>{formatValue(value, control.unit)}</small></span>
              <input type="range" min={control.min} max={control.max} step={control.step} value={value} onChange={(event) => updateControl(control.key, Number(event.target.value))} />
              <span className="camera-control-range"><small>{formatValue(control.min, control.unit)}</small><small>{formatValue(control.max, control.unit)}</small></span>
            </label>
          })}</div>}
          {choiceControls.length > 0 && <div className="camera-mode-grid">{choiceControls.map((control) => <label className="camera-mode-control" key={control.key}><span>{control.label}</span><select className="admin-input" value={typeof settings.controls[control.key] === 'string' ? settings.controls[control.key] as string : control.value} onChange={(event) => updateControl(control.key, event.target.value)}>{control.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select></label>)}</div>}
          {!numericControls.length && !choiceControls.length && <div className="camera-controls-empty"><SlidersHorizontal size={19} /><span>Kontrol kamera muncul di sini setelah kemampuan kamera dibaca.</span></div>}
        </section>
      </div>
    </section>
  )
}
