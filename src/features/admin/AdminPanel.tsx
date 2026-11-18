import { useMemo, useState } from 'react'
import { ArrowRight, Camera, CheckCircle2, ChevronRight, Cloud, CloudUpload, CreditCard, Database, FolderOpen, Image, Images, LayoutDashboard, LogOut, Printer, RefreshCw, Save, Settings2, ShieldCheck, Store, UserRound, Video, Wifi } from 'lucide-react'
import { BrandMark } from '../../components/shared/BrandMark'
import { ConnectionRow } from './components/ConnectionRow'
import { MetricCard } from './components/MetricCard'
import { CameraSettingsPanel } from '../camera/CameraSettingsPanel'
import { BoothFramesPanel } from '../camera/BoothFramesPanel'
import { parseCameraSettings, serializeCameraSettings } from '../camera/cameraSettings'
import { parseBoothFrames, serializeBoothFrames } from '../camera/boothFrames'
import type { AdminTab, Config } from '../../types/app'
import { money } from '../../utils/format'

export function AdminPanel({ activeTab, setActiveTab, config, setConfig, onSave, sessionCount, onExit }: {
  activeTab: AdminTab
  setActiveTab: (tab: AdminTab) => void
  config: Config
  setConfig: (config: Config) => void
  onSave: () => void
  sessionCount: number
  onExit: () => void
}) {
  const patch = <Key extends keyof Config,>(field: Key, value: Config[Key]) => setConfig({ ...config, [field]: value })
  const [storagePathError, setStoragePathError] = useState('')
  const [testingRclone, setTestingRclone] = useState(false)
  const [connectingRclone, setConnectingRclone] = useState(false)
  const [rcloneStatus, setRcloneStatus] = useState('')
  const [rcloneAccount, setRcloneAccount] = useState('')
  const chooseStoragePath = async () => {
    setStoragePathError('')
    try {
      const selection = await window.boothConfig?.chooseStoragePath()
      if (selection && !selection.canceled && selection.path) patch('storagePath', selection.path)
    } catch (error) {
      setStoragePathError(error instanceof Error ? error.message : 'Folder penyimpanan gagal dipilih.')
    }
  }
  const testRclone = async () => {
    setTestingRclone(true)
    setRcloneStatus('')
    try {
      const result = await window.boothConfig?.testRclone({
        executable: config.rcloneExecutable,
        remote: config.rcloneRemote,
        folder: config.rcloneFolder,
        configPath: config.rcloneConfigPath,
      })
      setRcloneStatus(result?.message ?? 'Pengujian rclone hanya tersedia di aplikasi desktop.')
      setRcloneAccount(result?.account || 'Akun tidak tersedia')
    } catch (error) {
      setRcloneStatus(error instanceof Error ? error.message : 'Koneksi rclone gagal.')
      setRcloneAccount('')
    } finally {
      setTestingRclone(false)
    }
  }
  const connectRclone = async () => {
    setConnectingRclone(true)
    setRcloneStatus('Ikuti login Google yang terbuka untuk menghubungkan akun.')
    setRcloneAccount('')
    try {
      const result = await window.boothConfig?.connectRclone({
        executable: config.rcloneExecutable,
        remote: config.rcloneRemote,
        folder: config.rcloneFolder,
        configPath: config.rcloneConfigPath,
      })
      setRcloneStatus(result?.message ?? 'Penghubungan akun hanya tersedia di aplikasi desktop.')
      setRcloneAccount(result?.account || 'Akun tidak tersedia')
    } catch (error) {
      setRcloneStatus(error instanceof Error ? error.message : 'Akun Google Drive gagal dihubungkan.')
    } finally {
      setConnectingRclone(false)
    }
  }
  const cameraSettings = useMemo(() => parseCameraSettings(config.cameraSettings), [config.cameraSettings])
  const boothFrames = useMemo(() => parseBoothFrames(config.boothFrames), [config.boothFrames])
  const nav: { id: AdminTab; title: string; caption: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', title: 'Ringkasan', caption: 'Status booth hari ini', icon: LayoutDashboard },
    { id: 'connections', title: 'Koneksi data', caption: 'Payment, backup & foto', icon: Database },
    { id: 'booth', title: 'Pengaturan booth', caption: 'Nama & harga sesi', icon: Store },
    { id: 'camera', title: 'Camera settings', caption: 'Pilih kamera & ISO', icon: Video },
    { id: 'frames', title: 'Booth Frames', caption: 'PNG, slot foto & preset', icon: Images },
    { id: 'sync', title: 'Sinkronisasi cloud', caption: 'Website & laporan', icon: Cloud },
  ]
  return <div className="admin-layout">
    <aside className="admin-sidebar"><div className="admin-brand"><BrandMark small /><span><b>CAPTURS</b><small>ADMIN STUDIO</small></span></div><div className="admin-location"><span className="status-dot" /><div><b>{config.storeName || 'Capturs Photobooth'}</b><small>Perangkat lokal</small></div></div><nav>{nav.map((item) => { const Icon = item.icon; return <button className={`admin-nav-item ${activeTab === item.id ? 'active' : ''}`} key={item.id} onClick={() => setActiveTab(item.id)}><Icon size={19} /><span><b>{item.title}</b><small>{item.caption}</small></span>{activeTab === item.id && <ChevronRight size={16} />}</button> })}</nav><div className="sidebar-bottom"><div className="sidebar-version"><span>CAPTURS DESKTOP</span><b>Versi 0.1.0 · Lokal</b></div><button className="exit-admin" onClick={onExit}><LogOut size={17} /> Kembali ke booth</button></div></aside>
    <section className="admin-main"><header className="admin-topbar"><div><span className="admin-breadcrumb">CAPTURS <ChevronRight size={13} /> ADMIN</span><b>{nav.find((item) => item.id === activeTab)?.title}</b></div><div className="admin-user"><span className="admin-avatar">C</span><span><b>Admin booth</b><small>{config.storeId || 'capturs-booth'}</small></span></div></header>
      <div className="admin-content">
        {activeTab === 'overview' && <>
          <div className="admin-title-row"><div><div className="eyebrow">SELAMAT DATANG KEMBALI</div><h2>Ringkasan booth</h2><p>Pantau sesi dan kondisi perangkat Capturs kamu.</p></div><div className="today-chip"><span className="status-dot" /> HARI INI · {new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date())}</div></div>
          <div className="notice-banner"><div className="notice-icon"><Settings2 size={19} /></div><div><b>Dashboard lokal siap digunakan</b><span>Hubungkan database dari menu Koneksi data untuk mengaktifkan sinkronisasi transaksi.</span></div><button onClick={() => setActiveTab('connections')}>Atur koneksi <ArrowRight size={15} /></button></div>
          <div className="metric-grid"><MetricCard icon={Image} label="SESI FOTO HARI INI" value={String(sessionCount)} foot="Sesi pada perangkat ini" tone="pink" /><MetricCard icon={Printer} label={config.operationMode === 'event' ? 'PEMBAYARAN EVENT' : 'PENDAPATAN TERCATAT'} value={config.operationMode === 'event' ? 'Event' : money(sessionCount * (Number(config.price) || 35000))} foot={config.operationMode === 'event' ? 'Biaya ditanggung penyelenggara' : 'Estimasi lokal · belum tersinkron'} tone="blue" /><MetricCard icon={Wifi} label="STATUS PERANGKAT" value="Online" foot="Aplikasi berjalan di booth ini" tone="green" /></div>
          <div className="admin-lower-grid"><section className="admin-card activity-card"><div className="card-heading"><div><b>Aktivitas terbaru</b><span>Riwayat sesi di perangkat ini</span></div><span className="local-pill">LOKAL</span></div>{sessionCount > 0 ? <div className="activity-row"><span className="activity-symbol"><Camera size={17} /></span><span><b>Sesi foto selesai</b><small>Capturs Photobooth · sesi #{String(sessionCount).padStart(4, '0')}</small></span><span className="activity-time">Baru saja</span></div> : <div className="empty-activity"><span className="empty-camera"><Camera size={20} /></span><b>Belum ada sesi hari ini</b><small>Sesi foto yang selesai akan muncul di sini.</small></div>}</section><section className="admin-card connection-card"><div className="card-heading"><div><b>Koneksi database</b><span>Kesiapan database</span></div><button className="small-link" onClick={() => setActiveTab('connections')}>Kelola <ArrowRight size={14} /></button></div><ConnectionRow icon={Database} name="MongoDB" info={config.mongoUri ? 'Konfigurasi tersedia' : 'Belum dikonfigurasi'} active={Boolean(config.mongoUri)} /></section></div>
          <div className="demo-disclaimer"><ShieldCheck size={14} /> Statistik di atas berasal dari perangkat ini. Integrasi database dan laporan multi-booth belum aktif.</div>
        </>}

        {activeTab === 'connections' && <>
          <div className="admin-title-row"><div><div className="eyebrow">DATABASE, PAYMENT & BACKUP</div><h2>Koneksi data</h2><p>Atur Midtrans, rclone, dan folder penyimpanan hasil sesi.</p></div><button className="save-button" onClick={onSave}><Save size={16} /> Simpan perubahan</button></div>
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
            <label className="rclone-toggle"><input type="checkbox" checked={config.rcloneEnabled === 'true'} onChange={(event) => patch('rcloneEnabled', event.target.checked ? 'true' : 'false')} /><span><b>Aktifkan upload & QR otomatis</b><small>Foto diupload ke folder Drive dan dibagikan lewat QR.</small></span></label>
            <div className="rclone-fields"><label><span>Executable rclone</span><input className="admin-input" value={config.rcloneExecutable} onChange={(event) => patch('rcloneExecutable', event.target.value)} placeholder="rclone" /></label><label><span>Nama remote</span><input className="admin-input" value={config.rcloneRemote} onChange={(event) => patch('rcloneRemote', event.target.value)} placeholder="gdrive" /></label><label><span>Folder Google Drive</span><input className="admin-input" value={config.rcloneFolder} onChange={(event) => patch('rcloneFolder', event.target.value)} placeholder="Capturs" /></label><label><span>File config rclone (opsional)</span><input className="admin-input" value={config.rcloneConfigPath} onChange={(event) => patch('rcloneConfigPath', event.target.value)} placeholder="Kosongkan untuk config default rclone" /></label><label><span>User Google Drive (email)</span><input className="admin-input readonly-input" value={rcloneAccount || 'Belum diperiksa'} readOnly /></label><label><span>Google OAuth Client ID (remote baru)</span><input className="admin-input" value={config.rcloneClientId} onChange={(event) => patch('rcloneClientId', event.target.value)} placeholder="...apps.googleusercontent.com" /></label><label><span>Google OAuth Client Secret (remote baru)</span><input className="admin-input" type="password" value={config.rcloneClientSecret} onChange={(event) => patch('rcloneClientSecret', event.target.value)} placeholder={config.rcloneClientSecretConfigured ? 'Tersimpan terenkripsi · isi untuk mengganti' : 'Client Secret dari Google Cloud'} autoComplete="new-password" /></label></div>
            <small className="field-help">Email akun dibaca otomatis. Hubungkan akun akan menyiapkan remote baru atau membuka login ulang untuk remote yang sudah ada. Token tetap dikelola rclone. Simpan perubahan sebelum menghubungkan akun.</small>
            <small className="field-help">Untuk remote baru, isi OAuth Client ID dan Secret dari Google Cloud (jenis Desktop app, dengan Google Drive API aktif); keduanya dipakai untuk login, dan Secret disimpan terenkripsi di perangkat. Remote yang sudah dikonfigurasi bisa memakai kredensialnya sendiri.</small>
            <div className="rclone-actions"><button className="storage-choose-button" type="button" onClick={() => { void connectRclone() }} disabled={connectingRclone || testingRclone}><UserRound size={14} className={connectingRclone ? 'spinning' : ''} /> {connectingRclone ? 'Menghubungkan…' : 'Hubungkan akun Google'}</button><button className="storage-choose-button" type="button" onClick={() => { void testRclone() }} disabled={testingRclone || connectingRclone}><RefreshCw size={14} className={testingRclone ? 'spinning' : ''} /> {testingRclone ? 'Menguji…' : 'Tes koneksi rclone'}</button>{rcloneStatus && <small role="status">{rcloneStatus}</small>}</div>
            <div className="connector-note"><span className="note-info">i</span><span>QR membuka folder publik. Siapa pun yang memiliki link dapat melihat gambar; link tidak kedaluwarsa otomatis dan bisa dicabut dari Google Drive. info.json tetap hanya di penyimpanan lokal.</span></div>
          </section>
        </>}

        {activeTab === 'booth' && <><div className="admin-title-row"><div><div className="eyebrow">IDENTITAS PERANGKAT</div><h2>Pengaturan booth</h2><p>Atur nama booth, mode operasional, dan harga sesi.</p></div><button className="save-button" onClick={onSave}><Save size={16} /> Simpan perubahan</button></div><section className="admin-card booth-settings-card"><div className="settings-section-title"><span className="config-icon mongo-icon"><Store size={20} /></span><div><b>Profil toko</b><span>Identitas ini akan mengikuti laporan sesi.</span></div></div><label className="input-label" htmlFor="store-name">Nama booth</label><input className="admin-input" id="store-name" value={config.storeName} onChange={(event) => patch('storeName', event.target.value)} /><label className="input-label" htmlFor="store-id">ID toko</label><input className="admin-input" id="store-id" value={config.storeId} onChange={(event) => patch('storeId', event.target.value)} /><small className="field-help">Gunakan ID unik untuk membedakan toko saat dashboard online dibuat.</small>
          <div className="settings-divider" /><div className="settings-section-title"><span className="config-icon blue-config-icon"><ShieldCheck size={20} /></span><div><b>Mode operasional</b><span>Pilih aturan pembayaran untuk semua sesi baru.</span></div></div><div className="operation-mode-grid"><button type="button" className={`operation-mode-card ${config.operationMode === 'dev' ? 'selected' : ''}`} aria-pressed={config.operationMode === 'dev'} onClick={() => patch('operationMode', 'dev')}><b>DEV mode</b><span>Uji Midtrans sandbox atau lewati payment saat development.</span></button><button type="button" className={`operation-mode-card ${config.operationMode === 'booth' ? 'selected' : ''}`} aria-pressed={config.operationMode === 'booth'} onClick={() => patch('operationMode', 'booth')}><b>Booth mode</b><span>Mode normal. Pembayaran Midtrans wajib sebelum sesi foto.</span></button><button type="button" className={`operation-mode-card ${config.operationMode === 'event' ? 'selected' : ''}`} aria-pressed={config.operationMode === 'event'} onClick={() => patch('operationMode', 'event')}><b>Event mode</b><span>Biaya sudah dibayar acara. Pembayaran dilewati dan pelanggan lanjut isi nama/email.</span></button></div>
          <div className="settings-divider" /><div className="settings-section-title"><span className="config-icon blue-config-icon"><Printer size={20} /></span><div><b>Harga sesi</b><span>Harga dasar yang tampil pada menu booth.</span></div></div><label className="input-label" htmlFor="session-price">Harga photo strip (IDR)</label><div className="price-input-wrap"><span>Rp</span><input className="admin-input" id="session-price" type="number" min="0" step="1000" value={config.price} onChange={(event) => patch('price', event.target.value)} /></div></section></>}

        {activeTab === 'camera' && <CameraSettingsPanel settings={cameraSettings} onChange={(settings) => patch('cameraSettings', serializeCameraSettings(settings))} onSave={onSave} />}

        {activeTab === 'frames' && <BoothFramesPanel settings={boothFrames} onChange={(settings) => patch('boothFrames', serializeBoothFrames(settings))} onSave={onSave} />}

        {activeTab === 'sync' && <><div className="admin-title-row"><div><div className="eyebrow">DASHBOARD ONLINE</div><h2>Sinkronisasi cloud</h2><p>Persiapan identitas untuk dashboard Capturs multi-toko.</p></div><button className="save-button" onClick={onSave}><Save size={16} /> Simpan perubahan</button></div><section className="admin-card cloud-card"><div className="cloud-illustration"><div className="cloud-circle"><Cloud size={30} /></div><span className="cloud-line line-one" /><span className="cloud-line line-two" /><span className="cloud-node node-one" /><span className="cloud-node node-two" /></div><div className="cloud-copy"><span className="coming-pill">TAHAP BERIKUTNYA</span><h3>Satu tempat untuk semua booth.</h3><p>Siapkan endpoint backend untuk mengirim sesi dan pendapatan toko ini ke dashboard web Capturs.</p><label className="input-label" htmlFor="sync-url">URL backend</label><input className="admin-input" id="sync-url" value={config.syncUrl} onChange={(event) => patch('syncUrl', event.target.value)} placeholder="https://api.domainkamu.com" /><label className="input-label" htmlFor="sync-store-id">ID toko</label><input className="admin-input readonly-input" id="sync-store-id" value={config.storeId} readOnly /><div className="connector-note"><span className="note-info">i</span><span>Website Vercel memerlukan backend/API tersendiri. Jangan hubungkan aplikasi web langsung ke MongoDB. Gunakan API/backend.</span></div></div></section><div className="sync-features"><div><CheckCircle2 size={17} /><span><b>Laporan per toko</b><small>Ringkasan pendapatan dan sesi</small></span></div><div><CheckCircle2 size={17} /><span><b>Identitas booth</b><small>ID perangkat untuk sinkronisasi</small></span></div><div><CheckCircle2 size={17} /><span><b>Mode lokal</b><small>Booth tetap berjalan tanpa internet</small></span></div></div></>}
      </div>
      <footer className="admin-footer"><span>Capturs Photobooth <i /> Panel administrasi perangkat</span><span>Konfigurasi lokal · {config.storeId || 'capturs-booth'}</span></footer>
    </section>
  </div>
}

