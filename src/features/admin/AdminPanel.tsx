import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Bell, Camera, CheckCircle2, ChevronRight, Cloud, CloudUpload, CreditCard, Database, FolderOpen, Image, Images, LayoutDashboard, LogOut, Printer, RefreshCw, Save, Settings2, ShieldCheck, Store, UserRound, Video, Wifi } from 'lucide-react'
import { BrandMark } from '../../components/shared/BrandMark'
import { ConnectionRow } from './components/ConnectionRow'
import { MetricCard } from './components/MetricCard'
import { CameraSettingsPanel } from '../camera/CameraSettingsPanel'
import { BoothFramesPanel } from '../camera/BoothFramesPanel'
import { parseCameraSettings, serializeCameraSettings } from '../camera/cameraSettings'
import { parseBoothFrames, serializeBoothFrameManifest } from '../camera/boothFrames'
import type { BoothFrameAssetUpload } from '../camera/boothFrames'
import type { AdminTab, Config } from '../../types/app'
import { money } from '../../utils/format'

export function AdminPanel({ activeTab, setActiveTab, config, setConfig, onSave, sessionCount, onExit }: {
  activeTab: AdminTab
  setActiveTab: (tab: AdminTab) => void
  config: Config
  setConfig: (config: Config) => void
  onSave: (assets?: BoothFrameAssetUpload[]) => void | Promise<boolean | void>
  sessionCount: number
  onExit: () => void
}) {
  const patch = <Key extends keyof Config,>(field: Key, value: Config[Key]) => setConfig({ ...config, [field]: value })
  const [storagePathError, setStoragePathError] = useState('')
  const [testingDrive, setTestingDrive] = useState(false)
  const [connectingDrive, setConnectingDrive] = useState(false)
  const [driveStatus, setDriveStatus] = useState('')
  const [driveAccount, setDriveAccount] = useState(config.googleDriveAccountEmail)
  const [driveClientSecret, setDriveClientSecret] = useState('')
  const [syncingCloud, setSyncingCloud] = useState(false)
  const [cloudSyncMessage, setCloudSyncMessage] = useState('')
  const [printers, setPrinters] = useState<BoothPrinter[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(false)
  const [testingPrinter, setTestingPrinter] = useState(false)
  const [printerMessage, setPrinterMessage] = useState('')
  const [printerError, setPrinterError] = useState('')
  const chooseStoragePath = async () => {
    setStoragePathError('')
    try {
      const selection = await window.boothConfig?.chooseStoragePath()
      if (selection && !selection.canceled && selection.path) patch('storagePath', selection.path)
    } catch (error) {
      setStoragePathError(error instanceof Error ? error.message : 'Folder penyimpanan gagal dipilih.')
    }
  }
  const testGoogleDrive = async () => {
    setTestingDrive(true)
    setDriveStatus('')
    try {
      const result = await window.boothConfig?.testGoogleDrive()
      setDriveStatus(result?.message ?? 'Pengujian Google Drive hanya tersedia di aplikasi desktop.')
      setDriveAccount(result?.account || 'Akun tidak tersedia')
    } catch (error) {
      setDriveStatus(error instanceof Error ? error.message : 'Koneksi Google Drive gagal.')
      setDriveAccount('')
    } finally {
      setTestingDrive(false)
    }
  }
  const connectGoogleDrive = async () => {
    setConnectingDrive(true)
    setDriveStatus('Login Google akan dibuka di browser sistem.')
    setDriveAccount('')
    try {
      const result = await window.boothConfig?.connectGoogleDrive({ clientId: config.googleDriveClientId, clientSecret: driveClientSecret })
      setDriveStatus(result?.message ?? 'Penghubungan akun hanya tersedia di aplikasi desktop.')
      setDriveAccount(result?.account || 'Akun tidak tersedia')
      if (result?.account) {
        setDriveClientSecret('')
        setConfig({ ...config, googleDriveAccountEmail: result.account })
      }
    } catch (error) {
      setDriveStatus(error instanceof Error ? error.message : 'Akun Google Drive gagal dihubungkan.')
    } finally {
      setConnectingDrive(false)
    }
  }
  const syncCloudNow = async () => {
    setSyncingCloud(true)
    setCloudSyncMessage('Menghubungkan ke dashboard web...')
    try {
      await window.boothConfig?.setFrameSyncApplyAllowed?.(true)
      let result = await window.boothConfig?.syncNow?.()
      if (result?.synced && result.framesDeferred) result = await window.boothConfig?.syncNow?.()
      if (result?.synced) {
        const stored = await window.boothConfig?.load()
        if (stored?.boothFrames) setConfig({ ...config, boothFrames: stored.boothFrames })
      }
      setCloudSyncMessage(result?.message ?? 'Sinkronisasi manual hanya tersedia di aplikasi desktop.')
    } catch (error) {
      setCloudSyncMessage(error instanceof Error ? error.message : 'Sinkronisasi cloud gagal.')
    } finally {
      setSyncingCloud(false)
    }
  }
  const refreshPrinters = async () => {
    if (!window.boothConfig?.listPrinters) {
      setPrinterError('Daftar printer hanya tersedia di aplikasi desktop.')
      return
    }
    setLoadingPrinters(true)
    setPrinterError('')
    setPrinterMessage('')
    try {
      setPrinters(await window.boothConfig.listPrinters())
    } catch (error) {
      setPrinterError(error instanceof Error ? error.message : 'Daftar printer gagal dimuat.')
    } finally {
      setLoadingPrinters(false)
    }
  }
  const testPrinter = async () => {
    if (!window.boothConfig?.testPrinter) {
      setPrinterError('Tes printer hanya tersedia di aplikasi desktop.')
      return
    }
    setTestingPrinter(true)
    setPrinterError('')
    setPrinterMessage('Mengirim halaman tes ke printer…')
    try {
      const result = await window.boothConfig.testPrinter({
        printerName: config.printerName,
        printerPaperSize: config.printerPaperSize,
        printerCopies: 1,
        printerColor: config.printerColor !== 'grayscale',
      })
      if (!result.printed) throw new Error(result.error || 'Printer tidak menerima halaman tes.')
      setPrinterMessage('Halaman tes berhasil dikirim ke printer.')
    } catch (error) {
      setPrinterMessage('')
      setPrinterError(error instanceof Error ? error.message : 'Tes printer gagal.')
    } finally {
      setTestingPrinter(false)
    }
  }
  useEffect(() => {
    if (activeTab === 'printer') void refreshPrinters()
  }, [activeTab])
  const cameraSettings = useMemo(() => parseCameraSettings(config.cameraSettings), [config.cameraSettings])
  const boothFrames = useMemo(() => parseBoothFrames(config.boothFrames), [config.boothFrames])
  const loadFrameAsset = useCallback((frameId: string) => {
    if (!window.boothConfig?.loadFrameAsset) return Promise.reject(new Error('Pemuatan PNG hanya tersedia di aplikasi booth.'))
    return window.boothConfig.loadFrameAsset(frameId)
  }, [])
  const nav: { id: AdminTab; title: string; caption: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', title: 'Ringkasan', caption: 'Status booth hari ini', icon: LayoutDashboard },
    { id: 'connections', title: 'Koneksi data', caption: 'Payment, backup & foto', icon: Database },
    { id: 'booth', title: 'Pengaturan booth', caption: 'Nama & harga sesi', icon: Store },
    { id: 'camera', title: 'Camera settings', caption: 'Pilih kamera & ISO', icon: Video },
    { id: 'frames', title: 'Booth Frames', caption: 'PNG, slot foto & preset', icon: Images },
    { id: 'printer', title: 'Printer settings', caption: 'Pilih printer & kertas', icon: Printer },
    { id: 'sync', title: 'Sinkronisasi cloud', caption: 'Website & laporan', icon: Cloud },
  ]
  return <div className="admin-layout">
    <aside className="admin-sidebar"><div className="admin-brand"><BrandMark small /><span><b>CAPTURS</b><small>ADMIN STUDIO</small></span></div><div className="admin-location"><span className="status-dot" /><div><b>{config.storeName || 'Capturs Photobooth'}</b><small>Perangkat lokal</small></div></div><nav>{nav.map((item) => { const Icon = item.icon; return <button className={`admin-nav-item ${activeTab === item.id ? 'active' : ''}`} key={item.id} onClick={() => setActiveTab(item.id)}><Icon size={19} /><span><b>{item.title}</b><small>{item.caption}</small></span>{activeTab === item.id && <ChevronRight size={16} />}</button> })}</nav><div className="sidebar-bottom"><div className="sidebar-version"><span>CAPTURS DESKTOP</span><b>Versi 0.1.0 · Lokal</b></div><button className="exit-admin" onClick={onExit}><LogOut size={17} /> Kembali ke booth</button></div></aside>
    <section className="admin-main"><header className="admin-topbar"><div><span className="admin-breadcrumb">CAPTURS <ChevronRight size={13} /> ADMIN</span><b>{nav.find((item) => item.id === activeTab)?.title}</b></div><div className="admin-user"><span className="admin-avatar">C</span><span><b>Admin booth</b><small>{config.storeId || 'capturs-booth'}</small></span></div></header>
      <div className="admin-content">
        {activeTab === 'overview' && <>
          <div className="admin-title-row"><div><div className="eyebrow">SELAMAT DATANG KEMBALI</div><h2>Ringkasan booth</h2><p>Pantau sesi dan kondisi perangkat Capturs kamu.</p></div><div className="today-chip"><span className="status-dot" /> HARI INI · {new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date())}</div></div>
          <div className="notice-banner"><div className="notice-icon"><Settings2 size={19} /></div><div><b>Dashboard lokal siap digunakan</b><span>Hubungkan database dari menu Koneksi data untuk mengaktifkan sinkronisasi transaksi.</span></div><button onClick={() => setActiveTab('connections')}>Atur koneksi <ArrowRight size={15} /></button></div>
          <div className="metric-grid"><MetricCard icon={Image} label="SESI FOTO HARI INI" value={String(sessionCount)} foot="Sesi pada perangkat ini" tone="pink" /><MetricCard icon={Printer} label={config.operationMode === 'event' ? 'PEMBAYARAN EVENT' : 'PENDAPATAN TERCATAT'} value={config.operationMode === 'event' ? 'Event' : money(sessionCount * (Number(config.photoStripPrice) || 35000))} foot={config.operationMode === 'event' ? 'Biaya ditanggung penyelenggara' : 'Estimasi lokal · belum tersinkron'} tone="blue" /><MetricCard icon={Wifi} label="STATUS PERANGKAT" value="Online" foot="Aplikasi berjalan di booth ini" tone="green" /></div>
          <div className="admin-lower-grid"><section className="admin-card activity-card"><div className="card-heading"><div><b>Aktivitas terbaru</b><span>Riwayat sesi di perangkat ini</span></div><span className="local-pill">LOKAL</span></div>{sessionCount > 0 ? <div className="activity-row"><span className="activity-symbol"><Camera size={17} /></span><span><b>Sesi foto selesai</b><small>Capturs Photobooth · sesi #{String(sessionCount).padStart(4, '0')}</small></span><span className="activity-time">Baru saja</span></div> : <div className="empty-activity"><span className="empty-camera"><Camera size={20} /></span><b>Belum ada sesi hari ini</b><small>Sesi foto yang selesai akan muncul di sini.</small></div>}</section><section className="admin-card connection-card"><div className="card-heading"><div><b>Koneksi database</b><span>Kesiapan database</span></div><button className="small-link" onClick={() => setActiveTab('connections')}>Kelola <ArrowRight size={14} /></button></div><ConnectionRow icon={Database} name="MongoDB" info={config.mongoUri ? 'Konfigurasi tersedia' : 'Belum dikonfigurasi'} active={Boolean(config.mongoUri)} /></section></div>
          <div className="demo-disclaimer"><ShieldCheck size={14} /> Statistik di atas berasal dari perangkat ini. Integrasi database dan laporan multi-booth belum aktif.</div>
        </>}

        {activeTab === 'connections' && <>
          <div className="admin-title-row"><div><div className="eyebrow">DATABASE, PAYMENT & BACKUP</div><h2>Koneksi data</h2><p>Atur Midtrans, Google Drive, dan folder penyimpanan hasil sesi.</p></div><button className="save-button" onClick={() => { void onSave() }}><Save size={16} /> Simpan perubahan</button></div>
          <div className="config-grid"><section className="admin-card config-card"><div className="config-card-heading"><span className="config-icon mongo-icon"><Database size={20} /></span><div><b>MongoDB</b><span>Database sesi dan transaksi</span></div><span className={`config-state ${config.mongoUri ? 'set' : ''}`}><i />{config.mongoUri ? 'DIATUR' : 'BELUM DIATUR'}</span></div><label className="input-label" htmlFor="mongo-uri">Connection string</label><input className="admin-input" id="mongo-uri" type="password" value={config.mongoUri} onChange={(event) => patch('mongoUri', event.target.value)} placeholder="mongodb+srv://username:••••@cluster..." /><small className="field-help">URI disimpan terenkripsi pada perangkat ini. Buat user database terpisah untuk setiap toko.</small><div className="connector-note"><span className="note-info">i</span><span>Connector database belum aktif pada versi ini. Simpan URI untuk persiapan integrasi berikutnya.</span></div></section>
            <section className="admin-card config-card storage-location-card">
              <div className="config-card-heading"><span className="config-icon blue-config-icon"><FolderOpen size={20} /></span><div><b>Penyimpanan foto lokal</b><span>Folder tujuan untuk hasil sesi</span></div></div>
              <div className="input-label">Folder penyimpanan</div>
              <div className="storage-path-row"><code id="storage-folder" title={config.storagePath || 'Documents/Capturs/storage'}>{config.storagePath || 'Documents/Capturs/storage'}</code><button className="storage-choose-button" type="button" disabled={!window.boothConfig?.chooseStoragePath} onClick={() => { void chooseStoragePath() }}><FolderOpen size={14} /> Pilih folder</button></div>
              <small className="field-help">Default: Documents/Capturs/storage. Klik Simpan perubahan untuk menerapkan folder pilihan. Pemilih folder tersedia di aplikasi desktop.</small>
              {storagePathError && <small className="storage-path-error">{storagePathError}</small>}
            </section>
          </div>
          <section className="admin-card integration-settings-card">
            <div className="settings-section-title"><span className="config-icon mongo-icon"><CreditCard size={20} /></span><div><b>Payment gateway · Midtrans</b><span>Pembayaran Midtrans langsung dari aplikasi booth.</span></div><span className={`config-state ${config.midtransClientKey && (config.midtransServerKeyConfigured || config.midtransServerKey.trim()) ? 'set' : ''}`}><i />{config.midtransClientKey && (config.midtransServerKeyConfigured || config.midtransServerKey.trim()) ? 'SIAP DIUJI' : 'PERLU DIATUR'}</span></div>
            <label className="input-label" htmlFor="payment-environment">Environment</label><select className="admin-input" id="payment-environment" value={config.paymentEnvironment} onChange={(event) => patch('paymentEnvironment', event.target.value as Config['paymentEnvironment'])}><option value="sandbox">Sandbox · transaksi percobaan</option><option value="production">Production · transaksi langsung</option></select>
            <label className="input-label" htmlFor="midtrans-client-key">Midtrans Client Key</label><input className="admin-input" id="midtrans-client-key" value={config.midtransClientKey} onChange={(event) => patch('midtransClientKey', event.target.value)} placeholder="SB-Mid-client-..." />
            <label className="input-label" htmlFor="midtrans-server-key">Midtrans Server Key</label><input className="admin-input" id="midtrans-server-key" type="password" value={config.midtransServerKey} onChange={(event) => patch('midtransServerKey', event.target.value)} placeholder={config.midtransServerKeyConfigured ? 'Tersimpan terenkripsi · isi untuk mengganti' : 'SB-Mid-server-...'} autoComplete="new-password" />
            <small className="field-help">Tempel Server Key mentah dari Dashboard Midtrans → Settings → Access Keys, sesuai environment dan merchant Client Key. Jangan gunakan Client Key atau key yang sudah di-Base64; aplikasi membuat Basic Auth otomatis. Key tersimpan tetap dipakai jika kolom ini dikosongkan.</small>
            <div className="connector-note"><span className="note-info">i</span><span>Server Key disimpan terenkripsi di perangkat dan dipakai oleh Electron untuk membuat token serta memverifikasi transaksi. Jaga akses fisik komputer booth; transaksi membutuhkan internet. Skip hanya tersedia di DEV mode, dan Event mode melewati gateway.</span></div>
          </section>
          <section className="admin-card integration-settings-card">
            <div className="settings-section-title"><span className="config-icon blue-config-icon"><CloudUpload size={20} /></span><div><b>Upload foto & QR Google Drive</b><span>Upload gambar sesi setelah foto tersimpan lokal.</span></div></div>
            <label className="google-drive-toggle"><input type="checkbox" checked={config.googleDriveEnabled === 'true'} onChange={(event) => patch('googleDriveEnabled', event.target.checked ? 'true' : 'false')} /><span><b>Aktifkan upload & QR otomatis</b><small>Foto diupload langsung ke Google Drive.</small></span></label>
            <div className="google-drive-fields"><label><span>Folder Google Drive</span><input className="admin-input" value={config.googleDriveFolder} onChange={(event) => patch('googleDriveFolder', event.target.value)} placeholder="Capturs" /></label><label><span>Akun Google Drive</span><input className="admin-input readonly-input" value={driveAccount || config.googleDriveAccountEmail || 'Belum terhubung'} readOnly /></label><label><span>OAuth Client ID (Desktop app)</span><input className="admin-input" value={config.googleDriveClientId} onChange={(event) => patch('googleDriveClientId', event.target.value)} placeholder="...apps.googleusercontent.com" /></label><label><span>OAuth Client Secret</span><input className="admin-input" type="password" autoComplete="new-password" value={driveClientSecret} onChange={(event) => setDriveClientSecret(event.target.value)} placeholder="Client Secret dari client yang sama" /></label></div>
            <small className="field-help">Buat OAuth Client jenis Desktop app di Google Cloud dan aktifkan Google Drive API. Masukkan Client ID dan Client Secret dari client yang sama; secret disimpan terenkripsi di perangkat. Untuk pemakaian rutin, set consent screen ke Production: refresh token dari mode Testing berakhir setelah 7 hari.</small>
            <div className="google-drive-retention-setting"><label htmlFor="google-drive-retention-days">Hapus folder Drive setelah</label><div><input className="admin-input" id="google-drive-retention-days" type="number" min="1" max="3650" step="1" value={config.googleDriveRetentionDays} onChange={(event) => patch('googleDriveRetentionDays', event.target.value)} /><span>hari</span></div><small>Berlaku untuk upload baru dan dihitung sejak upload selesai. Jika booth offline saat jatuh tempo, folder dihapus setelah booth kembali online. Upload lama sebelum fitur ini aktif tidak dicatat.</small></div>
            <div className="google-drive-actions"><button className="storage-choose-button" type="button" onClick={() => { void connectGoogleDrive() }} disabled={connectingDrive || testingDrive}><UserRound size={14} className={connectingDrive ? 'spinning' : ''} /> {connectingDrive ? 'Menghubungkan…' : 'Hubungkan akun Google'}</button><button className="storage-choose-button" type="button" onClick={() => { void testGoogleDrive() }} disabled={testingDrive || connectingDrive}><RefreshCw size={14} className={testingDrive ? 'spinning' : ''} /> {testingDrive ? 'Menguji…' : 'Tes koneksi Drive'}</button>{driveStatus && <small role="status">{driveStatus}</small>}</div>
            <div className="connector-note"><span className="note-info">i</span><span>QR membuka folder publik. Siapa pun yang memiliki link dapat melihat gambar; folder sesi dijadwalkan terhapus otomatis setelah masa retensi. info.json tetap hanya di penyimpanan lokal.</span></div>
          </section>
        </>}

        {activeTab === 'booth' && <><div className="admin-title-row"><div><div className="eyebrow">IDENTITAS PERANGKAT</div><h2>Pengaturan booth</h2><p>Atur nama booth, mode operasional, dan harga sesi.</p></div><button className="save-button" onClick={() => { void onSave() }}><Save size={16} /> Simpan perubahan</button></div><section className="admin-card booth-settings-card"><div className="settings-section-title"><span className="config-icon mongo-icon"><Store size={20} /></span><div><b>Profil toko</b><span>Identitas ini akan mengikuti laporan sesi.</span></div></div><label className="input-label" htmlFor="store-name">Nama booth</label><input className="admin-input" id="store-name" value={config.storeName} onChange={(event) => patch('storeName', event.target.value)} /><label className="input-label" htmlFor="store-id">ID toko</label><input className="admin-input" id="store-id" value={config.storeId} onChange={(event) => patch('storeId', event.target.value)} /><small className="field-help">Gunakan ID unik untuk membedakan toko saat dashboard online dibuat.</small>
          <div className="settings-divider" /><div className="settings-section-title"><span className="config-icon blue-config-icon"><ShieldCheck size={20} /></span><div><b>Mode operasional</b><span>Pilih aturan pembayaran untuk semua sesi baru.</span></div></div><div className="operation-mode-grid"><button type="button" className={`operation-mode-card ${config.operationMode === 'dev' ? 'selected' : ''}`} aria-pressed={config.operationMode === 'dev'} onClick={() => patch('operationMode', 'dev')}><b>DEV mode</b><span>Uji Midtrans sandbox atau lewati payment saat development.</span></button><button type="button" className={`operation-mode-card ${config.operationMode === 'booth' ? 'selected' : ''}`} aria-pressed={config.operationMode === 'booth'} onClick={() => patch('operationMode', 'booth')}><b>Booth mode</b><span>Mode normal. Pembayaran Midtrans wajib sebelum sesi foto.</span></button><button type="button" className={`operation-mode-card ${config.operationMode === 'event' ? 'selected' : ''}`} aria-pressed={config.operationMode === 'event'} onClick={() => patch('operationMode', 'event')}><b>Event mode</b><span>Biaya sudah dibayar acara. Pembayaran dilewati dan pelanggan lanjut isi nama/email.</span></button></div>
          <div className="settings-divider" /><div className="settings-section-title"><span className="config-icon blue-config-icon"><Printer size={20} /></span><div><b>Harga sesi</b><span>Harga photo strip dan foto tunggal diatur terpisah.</span></div></div><label className="input-label" htmlFor="photo-strip-price">Harga photo strip (IDR)</label><div className="price-input-wrap"><span>Rp</span><input className="admin-input" id="photo-strip-price" type="number" min="1" step="1000" value={config.photoStripPrice} onChange={(event) => patch('photoStripPrice', event.target.value)} required /></div><label className="input-label" htmlFor="single-photo-price">Harga foto tunggal (IDR)</label><div className="price-input-wrap"><span>Rp</span><input className="admin-input" id="single-photo-price" type="number" min="1" step="1000" value={config.singlePhotoPrice} onChange={(event) => patch('singlePhotoPrice', event.target.value)} required /></div><label className="input-label" htmlFor="session-timeout-minutes">Batas waktu sesi (menit)</label><input className="admin-input" id="session-timeout-minutes" type="number" min="1" max="60" step="1" value={config.sessionTimeoutMinutes} onChange={(event) => patch('sessionTimeoutMinutes', event.target.value)} required /><small className="field-help">Timer dimulai setelah pembayaran berhasil. Default 5 menit.</small></section></>}

        {activeTab === 'camera' && <CameraSettingsPanel settings={cameraSettings} onChange={(settings) => patch('cameraSettings', serializeCameraSettings(settings))} onSave={() => { void onSave() }} />}

        {activeTab === 'frames' && <BoothFramesPanel settings={boothFrames} onChange={(settings) => patch('boothFrames', serializeBoothFrameManifest(settings))} onSave={(assets) => onSave(assets)} loadFrameAsset={loadFrameAsset} />}

        {activeTab === 'printer' && <>
          <div className="admin-title-row"><div><div className="eyebrow">CETAK HASIL SESI</div><h2>Pengaturan printer</h2><p>Pilih printer dan ukuran kertas yang dipakai booth ini.</p></div><div className="connection-actions"><button className="storage-choose-button" type="button" onClick={() => { void refreshPrinters() }} disabled={loadingPrinters}><RefreshCw size={15} className={loadingPrinters ? 'spinning' : ''} /> {loadingPrinters ? 'Memuat printer…' : 'Muat ulang printer'}</button><button className="save-button" type="button" onClick={() => { void onSave() }}><Save size={16} /> Simpan perubahan</button></div></div>
          <section className="admin-card integration-settings-card printer-settings-card">
            <div className="settings-section-title"><span className="config-icon blue-config-icon"><Printer size={20} /></span><div><b>Printer foto</b><span>{printers.length ? `${printers.length} printer terdeteksi di komputer ini.` : 'Daftar printer komputer booth.'}</span></div><span className={`config-state ${printers.length ? 'set' : ''}`}><i />{printers.length ? 'TERHUBUNG' : 'BELUM TERDETEKSI'}</span></div>
            <label className="input-label" htmlFor="printer-name">Gunakan printer</label>
            <select className="admin-input" id="printer-name" value={config.printerName} onChange={(event) => patch('printerName', event.target.value)}>
              <option value="">Printer default komputer</option>
              {config.printerName && !printers.some((printer) => printer.name === config.printerName) && <option value={config.printerName}>{config.printerName} · belum terdeteksi</option>}
              {printers.map((printer) => <option value={printer.name} key={printer.name}>{printer.displayName || printer.name}{printer.isDefault ? ' · default' : ''}</option>)}
            </select>
            <div className="printer-options-grid">
              <label><span>Ukuran kertas</span><select className="admin-input" value={config.printerPaperSize} onChange={(event) => patch('printerPaperSize', event.target.value)}><option value="photo4x6">Foto 4 × 6 inci (10 × 15 cm)</option><option value="photo4x8">Foto 4 × 8 inci (10 × 20 cm)</option><option value="a4">A4</option><option value="a3">A3</option><option value="printer">Ikuti ukuran printer</option></select></label>
              <label><span>Jumlah salinan</span><select className="admin-input" value={config.printerCopies} onChange={(event) => patch('printerCopies', event.target.value)}>{[1, 2, 3, 4, 5].map((copies) => <option value={String(copies)} key={copies}>{copies} salinan</option>)}</select></label>
              <label><span>Mode warna</span><select className="admin-input" value={config.printerColor} onChange={(event) => patch('printerColor', event.target.value)}><option value="color">Berwarna</option><option value="grayscale">Hitam putih</option></select></label>
            </div>
            <label className="google-drive-toggle printer-auto-toggle"><input type="checkbox" checked={config.printerAutoPrint !== 'false'} onChange={(event) => patch('printerAutoPrint', event.target.checked ? 'true' : 'false')} /><span><b>Cetak otomatis setelah sesi disimpan</b><small>Hasil.png langsung dikirim tanpa membuka dialog cetak.</small></span></label>
            <div className="google-drive-actions printer-actions"><button className="storage-choose-button" type="button" onClick={() => { void testPrinter() }} disabled={testingPrinter || loadingPrinters}><Printer size={14} className={testingPrinter ? 'spinning' : ''} /> {testingPrinter ? 'Mengirim tes…' : 'Cetak halaman tes'}</button>{printerMessage && <small role="status">{printerMessage}</small>}{printerError && <small className="printer-error" role="alert">{printerError}</small>}</div>
            <div className="connector-note"><span className="note-info">i</span><span>Printer default komputer dipakai jika pilihan printer dikosongkan. Pengaturan ini berlaku lokal untuk booth ini dan tidak ikut tersinkron ke booth lain.</span></div>
          </section>
        </>}

        {activeTab === 'sync' && <><div className="admin-title-row"><div><div className="eyebrow">DASHBOARD ONLINE</div><h2>Sinkronisasi cloud</h2><p>Booth terdeteksi otomatis di web admin.</p></div><div className="connection-actions"><button className="storage-choose-button" onClick={() => { void syncCloudNow() }} disabled={syncingCloud}><RefreshCw size={15} className={syncingCloud ? 'spinning' : ''} /> {syncingCloud ? 'Menyinkronkan…' : 'Sinkronkan sekarang'}</button><button className="save-button" onClick={() => { void onSave() }}><Save size={16} /> Simpan perubahan</button></div></div><section className="admin-card cloud-card"><div className="cloud-illustration"><div className="cloud-circle"><Cloud size={30} /></div><span className="cloud-line line-one" /><span className="cloud-line line-two" /><span className="cloud-node node-one" /><span className="cloud-node node-two" /></div><div className="cloud-copy"><span className="coming-pill">{config.syncUrl ? 'DETEKSI OTOMATIS' : 'URL BELUM DIATUR'}</span><h3>Konfigurasi per booth, tanpa API key manual.</h3><p>Masukkan URL Web Admin dan simpan. Booth akan muncul otomatis di daftar Perangkat Booth untuk disetujui. Setelah aktif, harga, mode, pengaturan kamera, frame, dan konfigurasi aman lainnya tersinkron saat aplikasi online.</p><label className="input-label" htmlFor="sync-url">URL web admin</label><input className="admin-input" id="sync-url" value={config.syncUrl} onChange={(event) => patch('syncUrl', event.target.value)} placeholder="https://capturs-admin-api.vercel.app/" /><label className="input-label" htmlFor="sync-store-id">ID toko</label><input className="admin-input readonly-input" id="sync-store-id" value={config.storeId} readOnly /><div className="connection-actions"><button className="save-button" onClick={() => { void onSave() }}><Save size={16} /> Simpan koneksi</button><button className="storage-choose-button" onClick={() => setActiveTab('booth')}>Atur harga & mode</button></div>{cloudSyncMessage && <small role="status">{cloudSyncMessage}</small>}<div className="settings-divider" /><div className="settings-section-title"><span className="config-icon blue-config-icon"><Bell size={20} /></span><div><b>Log ke Telegram</b><span>Notifikasi sesi, pembayaran, konfigurasi, perangkat, dan frame.</span></div><span className={`config-state ${config.telegramBotTokenConfigured || config.telegramBotToken ? 'set' : ''}`}><i />{config.telegramBotTokenConfigured || config.telegramBotToken ? 'TOKEN TERSIMPAN' : 'BELUM DIATUR'}</span></div><label className="input-label" htmlFor="telegram-bot-token">Telegram Bot Token</label><input className="admin-input" id="telegram-bot-token" type="password" autoComplete="new-password" value={config.telegramBotToken} onChange={(event) => patch('telegramBotToken', event.target.value)} placeholder={config.telegramBotTokenConfigured ? 'Tersimpan terenkripsi · isi untuk mengganti' : 'Token dari @BotFather'} /><small className="field-help">Simpan token, lalu kirim /id ke bot dari chat tujuan. Chat ID tersimpan otomatis dan bisa diatur dari menu Telegram di WebAdmin. Token tetap terenkripsi di perangkat booth.</small><div className="connector-note"><span className="note-info">i</span><span>Identitas perangkat dibuat dan disimpan aman di booth. Web Admin menerima konfigurasi, ID transaksi berbayar, email pelanggan, waktu sesi, dan tautan Drive. Foto, MongoDB URI, Midtrans Server Key, kredensial Google, serta token bot tidak ikut masuk ke konfigurasi publik.</span></div></div></section><div className="sync-features"><div><CheckCircle2 size={17} /><span><b>Deteksi booth otomatis</b><small>Persetujuan cukup satu kali di Web Admin</small></span></div><div><CheckCircle2 size={17} /><span><b>Konfigurasi per perangkat</b><small>Frame, kamera, harga, dan mode tiap booth</small></span></div><div><CheckCircle2 size={17} /><span><b>Tetap lokal</b><small>Booth tetap bekerja saat internet putus</small></span></div></div></>}
      </div>
      <footer className="admin-footer"><span>Capturs Photobooth <i /> Panel administrasi perangkat</span><span>Konfigurasi lokal · {config.storeId || 'capturs-booth'}</span></footer>
    </section>
  </div>
}

