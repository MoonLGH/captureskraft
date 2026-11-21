import { useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, Upload } from 'lucide-react'
import { FrameEditor } from './components/FrameEditor'
import { createFramePreset, createId, frameApplicabilityLabel, isFullBoothFrameDataUrl, parseFramePreset, type BoothFrame, type BoothFrameAssetUpload, type BoothFramesSettings } from './boothFrames'

type BoothFramesPanelProps = {
  settings: BoothFramesSettings
  onChange: (settings: BoothFramesSettings) => void
  onSave: (assets: BoothFrameAssetUpload[]) => void | Promise<boolean | void>
  loadFrameAsset?: (frameId: string) => Promise<string>
}

function createThumbnail(dataUrl: string, widthLimit = 240): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('Preview frame tidak dapat dibuat.'))
    image.onload = () => {
      const scale = Math.min(1, widthLimit / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) return reject(new Error('Preview frame tidak dapat dibuat.'))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    image.src = dataUrl
  })
}

export function BoothFramesPanel({ settings, onChange, onSave, loadFrameAsset }: BoothFramesPanelProps) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingAssets, setPendingAssets] = useState<Map<string, string>>(new Map())
  const [loadedFrame, setLoadedFrame] = useState<BoothFrame | null>(null)
  const loadedFrameRef = useRef(loadedFrame)
  const [loadingFrame, setLoadingFrame] = useState(false)
  const settingsRef = useRef(settings)
  const onChangeRef = useRef(onChange)
  const pngInputRef = useRef<HTMLInputElement>(null)
  const presetInputRef = useRef<HTMLInputElement>(null)
  loadedFrameRef.current = loadedFrame
  settingsRef.current = settings
  onChangeRef.current = onChange
  const activeFrame = settings.frames.find((frame) => frame.id === settings.activeFrameId) ?? null
  const editorFrame = activeFrame && loadedFrame?.id === activeFrame.id ? loadedFrame : activeFrame

  useEffect(() => {
    let current = true
    if (!activeFrame) {
      setLoadedFrame(null)
      setLoadingFrame(false)
      return () => { current = false }
    }
    const pendingDataUrl = pendingAssets.get(activeFrame.id)
    const currentLoadedFrame = loadedFrameRef.current
    if (pendingDataUrl) {
      if (!currentLoadedFrame || currentLoadedFrame.id !== activeFrame.id || currentLoadedFrame.dataUrl !== pendingDataUrl || currentLoadedFrame.assetHash !== activeFrame.assetHash) {
        setLoadedFrame({ ...activeFrame, dataUrl: pendingDataUrl })
      }
      setLoadingFrame(false)
      return () => { current = false }
    }
    if (isFullBoothFrameDataUrl(activeFrame.dataUrl, activeFrame.thumbnailDataUrl ?? '')) {
      if (currentLoadedFrame !== activeFrame) setLoadedFrame(activeFrame)
      setLoadingFrame(false)
      return () => { current = false }
    }
    if (currentLoadedFrame?.id === activeFrame.id && currentLoadedFrame.assetHash === activeFrame.assetHash
      && isFullBoothFrameDataUrl(currentLoadedFrame.dataUrl, currentLoadedFrame.thumbnailDataUrl ?? '')) {
      setLoadingFrame(false)
      return () => { current = false }
    }
    if (!loadFrameAsset || !activeFrame.assetHash) {
      if (currentLoadedFrame !== activeFrame) setLoadedFrame(activeFrame)
      setLoadingFrame(false)
      return () => { current = false }
    }
    if (currentLoadedFrame) setLoadedFrame(null)
    setError('')
    setLoadingFrame(true)
    void loadFrameAsset(activeFrame.id).then(async (dataUrl) => {
      if (!current) return
      const latestSettings = settingsRef.current
      const latestFrame = latestSettings.frames.find((frame) => frame.id === activeFrame.id) ?? activeFrame
      const thumbnailDataUrl = latestFrame.thumbnailDataUrl || await createThumbnail(dataUrl)
      const loaded = { ...latestFrame, dataUrl, thumbnailDataUrl }
      setLoadedFrame(loaded)
      setError('')
      if (!latestFrame.thumbnailDataUrl) {
        onChangeRef.current({
          ...latestSettings,
          frames: latestSettings.frames.map((frame) => frame.id === activeFrame.id ? { ...frame, dataUrl: thumbnailDataUrl, thumbnailDataUrl } : frame),
        })
      }
    }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : 'Gambar frame gagal dimuat.')
    }).finally(() => {
      if (current) setLoadingFrame(false)
    })
    return () => { current = false }
  }, [activeFrame?.id, activeFrame?.assetHash, activeFrame?.dataUrl, activeFrame?.thumbnailDataUrl, loadFrameAsset, pendingAssets])

  const updateFrame = (nextFrame: BoothFrame) => {
    setLoadedFrame(nextFrame)
    const lightweightFrame = { ...nextFrame, dataUrl: nextFrame.thumbnailDataUrl ?? '' }
    onChange({
      ...settings,
      frames: settings.frames.map((frame) => frame.id === nextFrame.id ? lightweightFrame : frame),
    })
  }

  const saveChanges = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const result = await onSave([...pendingAssets].map(([frameId, dataUrl]) => ({ frameId, dataUrl })))
      if (result !== false) {
        setPendingAssets(new Map())
        setMessage('Metadata tersimpan; PNG disimpan terpisah.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Frame gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  const addFrame = async (name: string, dataUrl: string, width: number, height: number, slots: BoothFrame['slots'] = []) => {
    if (dataUrl.length + 14 > 4_490_000) throw new Error('PNG frame melewati batas unggah 4,49 MB setelah encoding. Kecilkan file ini sebelum menambahkannya.')
    const thumbnailDataUrl = await createThumbnail(dataUrl)
    const frame: BoothFrame = {
      id: createId(), name, dataUrl: thumbnailDataUrl, thumbnailDataUrl,
      width, height, appliesTo: 'both', slots,
    }
    setPendingAssets((current) => new Map(current).set(frame.id, dataUrl))
    setLoadedFrame({ ...frame, dataUrl })
    onChange({
      frames: [...settings.frames.map((item) => ({ ...item, dataUrl: item.thumbnailDataUrl ?? '' })), frame],
      activeFrameId: frame.id,
    })
    return frame
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
        void addFrame(file.name.replace(/\.png$/i, ''), dataUrl, image.naturalWidth, image.naturalHeight)
          .then((frame) => setMessage(`Frame ${frame.name} ditambahkan. Tambah slot foto lalu simpan.`))
          .catch((cause) => setError(cause instanceof Error ? cause.message : 'Frame gagal ditambahkan.'))
      }
      image.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const exportFrame = () => {
    if (!editorFrame || loadingFrame || !isFullBoothFrameDataUrl(editorFrame.dataUrl, editorFrame.thumbnailDataUrl ?? '')) return
    const blob = new Blob([JSON.stringify(createFramePreset(editorFrame), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${editorFrame.name.replace(/[^a-z0-9-_]+/gi, '-') || 'booth-frame'}.capturs-frame.json`
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
      const frame = await addFrame(imported.name, imported.dataUrl, imported.width, imported.height,
        imported.slots.map((slot) => ({ ...slot, id: createId('slot') })))
      setMessage(`Preset “${frame.name}” berhasil diimpor. Simpan perubahan untuk menerapkannya.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preset tidak dapat dibaca.')
    }
  }

  const deleteFrame = (frameId: string) => {
    const frames = settings.frames.filter((frame) => frame.id !== frameId)
    const activeFrameId = settings.activeFrameId === frameId ? frames[0]?.id ?? '' : settings.activeFrameId
    onChange({ frames, activeFrameId })
    setPendingAssets((current) => {
      const next = new Map(current)
      next.delete(frameId)
      return next
    })
    if (loadedFrame?.id === frameId) setLoadedFrame(null)
  }

  return (
    <section className="booth-frames-panel">
      <div className="admin-title-row">
        <div><div className="eyebrow">FRAME FOTO PER BOOTH</div><h2>Booth Frames</h2><p>Metadata dan thumbnail ringan disimpan terpisah dari PNG frame penuh.</p></div>
        <div className="camera-preset-actions">
          <button className="soft-button" type="button" onClick={() => presetInputRef.current?.click()}><Upload size={15} /> Impor preset</button>
          <button className="soft-button" type="button" onClick={exportFrame} disabled={!editorFrame || loadingFrame || !isFullBoothFrameDataUrl(editorFrame.dataUrl, editorFrame.thumbnailDataUrl ?? '')}><Download size={15} /> Ekspor frame</button>
          <button className="save-button" type="button" onClick={() => { void saveChanges() }} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan perubahan'}</button>
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
              {frame.thumbnailDataUrl || frame.dataUrl ? <img src={frame.thumbnailDataUrl || frame.dataUrl} alt="" /> : <span className="booth-frame-empty-thumb"><ImagePlus size={15} /></span>}
              <span><b>{frame.name}</b><small>{frameApplicabilityLabel(frame.appliesTo)} · {frame.slots.length} slot · {frame.width} × {frame.height} px</small></span>
              <span className="booth-frame-active-dot" />
            </button>
          ))}
          <button className="booth-frame-add-full" type="button" onClick={() => pngInputRef.current?.click()}><ImagePlus size={15} /> Tambah PNG mentah</button>
        </aside>

        <section className="booth-frame-editor-card admin-card">
          {editorFrame
            ? loadingFrame ? <div className="frame-empty-state"><b>Memuat gambar frame terpilih…</b></div>
              : <FrameEditor key={editorFrame.id} frame={editorFrame} onChange={updateFrame} onRename={(name) => updateFrame({ ...editorFrame, name })} onRemove={(slotId) => updateFrame({ ...editorFrame, slots: editorFrame.slots.filter((slot) => slot.id !== slotId) })} onDeleteFrame={() => deleteFrame(editorFrame.id)} />
            : <div className="frame-empty-state"><span className="frame-empty-icon"><ImagePlus size={22} /></span><b>Pilih atau tambahkan frame</b><small>Gambar penuh hanya dimuat untuk frame yang sedang diedit.</small><button className="soft-button" type="button" onClick={() => pngInputRef.current?.click()}><ImagePlus size={15} /> Tambah PNG frame</button></div>}
        </section>
      </div>
      <small className="frame-sync-size">PNG disimpan sebagai file terpisah; hanya frame baru atau berubah yang diunggah saat disimpan. {pendingAssets.size ? `${pendingAssets.size} gambar baru siap disimpan.` : ''}</small>
      {(message || error) && <div className={`camera-settings-message ${error ? 'error' : ''}`}>{error || message}</div>}
    </section>
  )
}
