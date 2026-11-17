import { useRef, useState } from 'react'
import { Download, ImagePlus, Trash2, Upload } from 'lucide-react'
import { FrameEditor } from './components/FrameEditor'
import { createFramePreset, createId, getFramePhotoIndexes, parseFramePreset, type BoothFrame, type BoothFramesSettings } from './boothFrames'

type BoothFramesPanelProps = {
  settings: BoothFramesSettings
  onChange: (settings: BoothFramesSettings) => void
  onSave: () => void
}

export function BoothFramesPanel({ settings, onChange, onSave }: BoothFramesPanelProps) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const pngInputRef = useRef<HTMLInputElement>(null)
  const presetInputRef = useRef<HTMLInputElement>(null)
  const activeFrame = settings.frames.find((frame) => frame.id === settings.activeFrameId) ?? null

  const updateFrame = (nextFrame: BoothFrame) => {
    onChange({
      ...settings,
      frames: settings.frames.map((frame) => frame.id === nextFrame.id ? nextFrame : frame),
    })
  }

  const loadPng = (file: File | undefined) => {
    if (!file) return
    setMessage('')
    setError('')
    if (file.type !== 'image/png' && !(file.type === '' && file.name.toLowerCase().endsWith('.png'))) {
      setError('Frame harus berupa file PNG.')
      return
    }

    const reader = new FileReader()
    reader.onerror = () => setError('File PNG tidak dapat dibaca.')
    reader.onload = () => {
      const dataUrl = reader.result
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
        setError('File PNG tidak dapat dibaca.')
        return
      }
      const image = new Image()
      image.onerror = () => setError('File yang dipilih bukan gambar PNG yang valid.')
      image.onload = () => {
        const frame: BoothFrame = {
          id: createId(),
          name: file.name.replace(/\.png$/i, ''),
          dataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
          slots: [],
        }
        onChange({ frames: [...settings.frames, frame], activeFrameId: frame.id })
        setMessage(`Frame ditambahkan pada ukuran asli ${frame.width} × ${frame.height} px. Tambah slot foto lalu simpan.`)
      }
      image.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const exportFrame = () => {
    if (!activeFrame) return
    const blob = new Blob([JSON.stringify(createFramePreset(activeFrame), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${activeFrame.name.replace(/[^a-z0-9-_]+/gi, '-') || 'booth-frame'}.capturs-frame.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Preset frame diekspor dengan PNG dan semua posisi slot.')
    setError('')
  }

  const importFrame = async (file: File | undefined) => {
    if (!file) return
    setMessage('')
    setError('')
    try {
      const raw: unknown = JSON.parse(await file.text())
      const imported = parseFramePreset(raw)
      if (!imported) throw new Error('Preset Booth Frame tidak dikenali atau tidak valid.')

      const frame: BoothFrame = {
        ...imported,
        id: createId(),
        slots: imported.slots.map((slot) => ({ ...slot, id: createId('slot') })),
      }
      onChange({ frames: [...settings.frames, frame], activeFrameId: frame.id })
      setMessage(`Preset “${frame.name}” berhasil diimpor pada ukuran asli ${frame.width} × ${frame.height} px. Simpan perubahan untuk menerapkannya.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preset tidak dapat dibaca.')
    }
  }

  const deleteFrame = (frameId: string) => {
    const frames = settings.frames.filter((frame) => frame.id !== frameId)
    const activeFrameId = settings.activeFrameId === frameId ? frames[0]?.id ?? '' : settings.activeFrameId
    onChange({ frames, activeFrameId })
  }

  return (
    <section className="booth-frames-panel">
      <div className="admin-title-row">
        <div><div className="eyebrow">FRAME FOTO PER BOOTH</div><h2>Booth Frames</h2><p>Atur slot per frame dan gunakan satu foto sumber di beberapa slot jika perlu.</p></div>
        <div className="camera-preset-actions">
          <button className="soft-button" type="button" onClick={() => presetInputRef.current?.click()}><Upload size={15} /> Impor preset</button>
          <button className="soft-button" type="button" onClick={exportFrame} disabled={!activeFrame}><Download size={15} /> Ekspor frame</button>
          <button className="save-button" type="button" onClick={onSave}>Simpan perubahan</button>
        </div>
      </div>

      <input ref={pngInputRef} className="visually-hidden-input" type="file" accept="image/png,.png" onChange={(event) => { loadPng(event.target.files?.[0]); event.currentTarget.value = '' }} />
      <input ref={presetInputRef} className="visually-hidden-input" type="file" accept="application/json,.json" onChange={(event) => { void importFrame(event.target.files?.[0]); event.currentTarget.value = '' }} />

      <div className="booth-frame-manager">
        <aside className="booth-frame-list admin-card">
          <div className="booth-frame-list-heading"><div><b>Daftar frame</b><small>{settings.frames.length} frame tersimpan</small></div><button className="frame-add-button" type="button" onClick={() => pngInputRef.current?.click()} aria-label="Tambah PNG frame"><ImagePlus size={16} /></button></div>
          {settings.frames.length === 0 && <p className="frame-list-empty">Belum ada frame. Tambahkan PNG untuk membuat frame pertama.</p>}
          {settings.frames.map((frame) => (
            <button key={frame.id} className={`booth-frame-choice ${settings.activeFrameId === frame.id ? 'active' : ''}`} type="button" onClick={() => onChange({ ...settings, activeFrameId: frame.id })}>
              <img src={frame.dataUrl} alt="" />
              <span><b>{frame.name}</b><small>{frame.slots.length} slot · {getFramePhotoIndexes(frame).length} foto · {frame.width} × {frame.height} px</small></span>
              <span className="booth-frame-active-dot" />
            </button>
          ))}
          <button className="booth-frame-add-full" type="button" onClick={() => pngInputRef.current?.click()}><ImagePlus size={15} /> Tambah PNG mentah</button>
        </aside>

        <section className="booth-frame-editor-card admin-card">
          {activeFrame
            ? <FrameEditor key={activeFrame.id} frame={activeFrame} onChange={updateFrame} onRename={(name) => updateFrame({ ...activeFrame, name })} onRemove={(slotId) => updateFrame({ ...activeFrame, slots: activeFrame.slots.filter((slot) => slot.id !== slotId) })} onDeleteFrame={() => deleteFrame(activeFrame.id)} />
            : <div className="frame-empty-state"><span className="frame-empty-icon"><ImagePlus size={22} /></span><b>Pilih atau tambahkan frame</b><small>PNG disimpan pada ukuran aslinya. Duplikat slot bisa memakai foto sumber yang sama tanpa menambah jepretan.</small><button className="soft-button" type="button" onClick={() => pngInputRef.current?.click()}><ImagePlus size={15} /> Tambah PNG frame</button></div>}
        </section>
      </div>
      {(message || error) && <div className={`camera-settings-message ${error ? 'error' : ''}`}>{error || message}</div>}
    </section>
  )
}
