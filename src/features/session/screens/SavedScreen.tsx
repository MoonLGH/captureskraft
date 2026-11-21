import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Clock3, CloudOff, Film, Image as ImageIcon, Printer, Sparkles } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

type SavedPreviewFiles = {
  image: Uint8Array | null
  gif: Uint8Array | null
  live: Uint8Array | null
}

type SavedScreenProps = {
  sessionCount: number
  deliveryStatus: string
  printError: string
  driveLink: string
  driveExpiresAt: string
  driveUploadStatus: 'disabled' | 'uploading' | 'uploaded' | 'error'
  driveUploadError: string
  driveRetentionDays: number
  autoReturn: boolean
  previewFiles: SavedPreviewFiles | null
  onHome: () => void
}

function createPreviewUrl(bytes: Uint8Array, type: string) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return URL.createObjectURL(new Blob([buffer], { type }))
}

export function SavedScreen({ sessionCount, deliveryStatus, printError, driveLink, driveExpiresAt, driveUploadStatus, driveUploadError, driveRetentionDays, autoReturn, previewFiles, onHome }: SavedScreenProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(30)
  const [activePreview, setActivePreview] = useState<'image' | 'gif' | 'live'>('image')
  const [previewUrls, setPreviewUrls] = useState<{ image: string; gif: string; live: string }>({ image: '', gif: '', live: '' })
  const onHomeRef = useRef(onHome)
  onHomeRef.current = onHome

  useEffect(() => {
    const imageUrl = previewFiles?.image?.byteLength
      ? createPreviewUrl(previewFiles.image, 'image/png')
      : ''
    const gifUrl = previewFiles?.gif?.byteLength
      ? createPreviewUrl(previewFiles.gif, 'image/gif')
      : ''
    const liveUrl = previewFiles?.live?.byteLength
      ? createPreviewUrl(previewFiles.live, 'video/mp4')
      : ''
    setPreviewUrls({ image: imageUrl, gif: gifUrl, live: liveUrl })
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
      if (gifUrl) URL.revokeObjectURL(gifUrl)
      if (liveUrl) URL.revokeObjectURL(liveUrl)
    }
  }, [previewFiles])

  useEffect(() => {
    if (!autoReturn) return
    const tickTimer = window.setInterval(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1))
    }, 1000)
    const homeTimer = window.setTimeout(() => onHomeRef.current(), 30_000)
    return () => {
      window.clearInterval(tickTimer)
      window.clearTimeout(homeTimer)
    }
  }, [autoReturn])

  const shownPreview = activePreview === 'gif' && previewUrls.gif
    ? { type: 'gif' as const, url: previewUrls.gif }
    : activePreview === 'live' && previewUrls.live
      ? { type: 'live' as const, url: previewUrls.live }
      : previewUrls.image
      ? { type: 'image' as const, url: previewUrls.image }
      : previewUrls.gif
        ? { type: 'gif' as const, url: previewUrls.gif }
        : previewUrls.live
          ? { type: 'live' as const, url: previewUrls.live }
          : null
  const sessionDate = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())
  const driveExpirationDate = Number.isFinite(Date.parse(driveExpiresAt))
    ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(driveExpiresAt))
    : ''

  return (
    <section className="saved-page">
      <div className="saved-content">
        <header className="saved-heading">
          <div className="saved-icon"><Check size={30} strokeWidth={2.5} /></div>
          <div className="eyebrow">MOMENMU SUDAH TERSIMPAN</div>
          <h5>Makasih sudah bikin momen bareng kami!</h5>
        </header>

        <div className="saved-layout">
          <section className="saved-preview-card" aria-label="Pratinjau hasil sesi foto">
            <div className="saved-preview-body">
              <div className="saved-preview-sidebar">
                <div className="saved-card-heading">
                  <div><span className="saved-section-kicker">KENANGAN KECILMU</span><h3>Hasil sesi foto</h3></div>
                  <span className="saved-ready-badge"><Sparkles size={13} /> SIAP</span>
                </div>
                <div className="saved-preview-tabs" role="tablist" aria-label="Pilih pratinjau">
                  <button type="button" role="tab" aria-selected={shownPreview?.type === 'image'} className={shownPreview?.type === 'image' ? 'active' : ''} disabled={!previewUrls.image} onClick={() => setActivePreview('image')}>
                    <ImageIcon size={17} /><span><b>Hasil cetak</b><small>Foto strip</small></span>
                  </button>
                  <button type="button" role="tab" aria-selected={shownPreview?.type === 'gif'} className={shownPreview?.type === 'gif' ? 'active' : ''} disabled={!previewUrls.gif} onClick={() => setActivePreview('gif')}>
                    <Film size={17} /><span><b>Boomerang</b><small>GIF animasi</small></span>
                  </button>
                  <button type="button" role="tab" aria-selected={shownPreview?.type === 'live'} className={shownPreview?.type === 'live' ? 'active' : ''} disabled={!previewUrls.live} onClick={() => setActivePreview('live')}>
                    <Film size={17} /><span><b>Live Photos</b><small>FRAME + LIVE PHOTOS</small></span>
                  </button>
                </div>
              </div>
              <div className={`saved-preview-stage ${shownPreview?.type === 'gif' ? 'is-gif' : ''} ${shownPreview?.type === 'live' ? 'is-live' : ''}`}>
                {shownPreview
                  ? shownPreview.type === 'live'
                    ? <video key={shownPreview.url} src={shownPreview.url} autoPlay loop muted playsInline controls preload="auto" aria-label="Pratinjau Live Photos sesi foto" />
                    : <img src={shownPreview.url} alt={shownPreview.type === 'gif' ? 'Pratinjau Boomerang sesi foto' : 'Pratinjau hasil foto siap cetak'} />
                  : <div className="saved-preview-empty"><ImageIcon size={30} /><b>Pratinjau sedang disiapkan</b><span>File foto sudah tersimpan bersama sesi ini.</span></div>}
                {shownPreview?.type === 'gif' && <span className="saved-gif-label"><Film size={12} /> BERGERAK</span>}
              </div>
            </div>
          </section>

          <aside className={`saved-share-card ${driveLink ? 'has-link' : 'local-only'}`}>
            {driveLink ? <>
              <div className="saved-share-heading"><span className="saved-share-icon"><ImageIcon size={18} /></span><div><span className="saved-section-kicker">SALINAN DIGITAL</span><h3>Bawa pulang fotomu</h3></div></div>
              <p className="saved-share-intro">Pindai kode ini dengan kamera ponsel untuk membuka folder hasil foto.</p>
              <div className="saved-drive-qr"><QRCodeSVG value={driveLink} size={280} level="M" title="QR code untuk membuka folder foto di Google Drive" /></div>
              {driveUploadStatus !== 'error' && <div className="saved-retention-notice"><Clock3 size={20} /><span><strong>Hasil foto hanya tersedia {driveRetentionDays} hari</strong><small>{driveUploadStatus === 'uploaded' ? `Unduh foto dan Live Photos sebelum ${driveExpirationDate || 'masa simpan habis'}.` : 'Masa simpan dimulai setelah file siap. Unduh segera setelah tersedia.'}</small></span></div>}
              {driveUploadStatus === 'error' && <p className="saved-delivery-status" role="alert"><CloudOff size={14} /> {driveUploadError || 'Upload Google Drive gagal.'}</p>}
              {printError && <p className="saved-delivery-status" role="alert"><Printer size={14} /> Cetak gagal: {printError}</p>}
              {deliveryStatus && <p className="saved-delivery-status"><Check size={14} />{deliveryStatus}</p>}
            </> : driveExpiresAt ? <>
              <div className="saved-share-heading"><span className="saved-share-icon"><ImageIcon size={18} /></span><div><span className="saved-section-kicker">SALINAN DIGITAL</span><h3>Foto sudah diunggah</h3></div></div>
              <p className="saved-share-intro">Upload ke Google Drive berhasil, tetapi QR belum tersedia. Minta operator membuka folder hasil sesi ini.</p>
              <div className="saved-share-note"><Sparkles size={15} /><span>Folder Drive dijadwalkan terhapus pada {driveExpirationDate || `${driveRetentionDays} hari setelah diunggah`}. Booth akan menghapusnya saat tersambung online.</span></div>
              {printError && <p className="saved-delivery-status" role="alert"><Printer size={14} /> Cetak gagal: {printError}</p>}
              {deliveryStatus && <p className="saved-delivery-status"><Check size={14} />{deliveryStatus}</p>}
            </> : <>
              <div className="saved-share-heading"><span className="saved-share-icon muted"><CloudOff size={18} /></span><div><span className="saved-section-kicker">SALINAN DIGITAL</span><h3>Foto tersimpan aman</h3></div></div>
              <p className="saved-share-intro">Belum ada tautan unduhan untuk sesi ini. Hasil fotomu tetap bisa dilihat di pratinjau.</p>
              <div className="saved-local-illustration"><ImageIcon size={37} /><span>HASIL FOTO<br />TERSIMPAN DI BOOTH</span></div>
              <div className="saved-share-note"><Sparkles size={15} /><span>Email dicatat bersama sesi. Jika pengiriman email dan Google Drive diaktifkan di WebAdmin, tautan unduhan akan dikirim setelah upload selesai.</span></div>
              {printError && <p className="saved-delivery-status" role="alert"><Printer size={14} /> Cetak gagal: {printError}</p>}
              {deliveryStatus && <p className="saved-delivery-status"><Check size={14} />{deliveryStatus}</p>}
            </>}
          </aside>
        </div>

        <footer className="saved-footer">
          <div className="saved-ticket"><span className="saved-ticket-mark"><Check size={15} /></span><div><span>SESI FOTO</span><b>#{String(sessionCount).padStart(4, '0')}</b></div><i /><span className="saved-ticket-date">{sessionDate}</span></div>
          {autoReturn && <div className="saved-countdown-wrap" role="timer" aria-live="off">
            <div className="saved-countdown-copy"><Clock3 size={15} /><span>Kembali ke menu dalam <strong>{secondsRemaining} detik</strong></span></div>
            <div className="saved-countdown-track"><span style={{ width: `${(secondsRemaining / 30) * 100}%` }} /></div>
          </div>}
          <button className="primary-cta compact saved-home-button" onClick={onHome}><span>Kembali ke menu utama</span><span className="cta-icon"><ArrowRight size={20} /></span></button>
        </footer>
      </div>
    </section>
  )
}
