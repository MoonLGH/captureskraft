import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, ArrowRight, ArrowUpRight, Bell, Camera, Check, CheckCircle2,
  ChevronDown, CircleHelp, Cloud, CreditCard, LayoutDashboard, LoaderCircle,
  LogOut, Mail, Pencil, RefreshCw, Search, Settings2, ShieldCheck, Store, Trash2, Wifi,
  WifiOff,
} from 'lucide-react'
import { BoothFramesPanel } from '../../src/features/camera/BoothFramesPanel'
import { parseBoothFrames, serializeBoothFrameManifest } from '../../src/features/camera/boothFrames'
import type { BoothFrameAssetUpload, BoothFramesSettings } from '../../src/features/camera/boothFrames'
import './frames.css'

type View = 'overview' | 'sessions' | 'payments' | 'booths' | 'settings' | 'email' | 'telegram'
type Settings = {
  storeName: string
  photoStripPrice: string
  singlePhotoPrice: string
  sessionTimeoutMinutes: string
  operationMode: 'dev' | 'booth' | 'event'
  paymentEnvironment: 'sandbox' | 'production'
  midtransClientKey: string
  googleDriveEnabled: string
  googleDriveRetentionDays: string
  googleDriveFolder: string
  cameraSettings: string
  boothFrames: string
  revision: number
  frameRevision: number
  updatedAt: string
}
type Device = { _id: string; name: string; createdAt: string; lastSeenAt?: string | null; isOnline: boolean; status: 'pending' | 'approved' | 'revoked'; configRevision: number }
type DeviceRun = { runId: string; deviceName: string; startedAt: string; receivedAt: string }
type Session = {
  sessionId: string
  createdAt: string
  customerEmail: string
  operationMode: string
  paymentStatus: string
  paymentOrderId: string
  experience: string
  sessionOutcome: string
  shotCount: number
  amount: number
  driveUploaded: boolean
  driveLink: string
  driveExpiresAt: string
  emailStatus: string
  emailError: string
  deviceId: string
  deviceName: string
}
type Payment = {
  paymentOrderId: string
  paymentStatus: string
  paidAt: string
  amount: number
  experience: string
  operationMode: string
  paymentEnvironment: string
  sessionOutcome: string
  customerEmail: string
  driveUploaded: boolean
  driveLink: string
  driveExpiresAt: string
  emailStatus: string
  emailError: string
  deviceId: string
  sessionId: string
  sessionCreatedAt: string | null
  deviceName: string
}
type TelegramSettings = { chatId: string; linked: boolean; deviceName: string; deviceOnline: boolean; updatedAt: string | null }
type EmailSettings = {
  enabled: boolean
  mode: 'smtp' | 'gmail'
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  fromName: string
  fromAddress: string
  usernameConfigured: boolean
  passwordConfigured: boolean
  revision: number
  updatedAt: string
}
type EmailSettingsForm = EmailSettings & { username: string; password: string }
type DashboardData = {
  settings: { storeId: string; storeName: string }
  metrics: { sessionsToday: number; paidToday: number; revenueToday: number; sessionsMonth: number; revenueMonth: number; onlineBooths: number; boothCount: number }
  chart: { date: string; sessions: number; revenue: number }[]
  sessions: Session[]
}

async function hashFrameDataUrl(dataUrl: string) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    signal: options.signal ?? AbortSignal.timeout(30_000),
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Request gagal (${response.status}).`)
  return result as T
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  let failed = false
  let failure: unknown
  const worker = async () => {
    while (!failed) {
      const index = nextIndex++
      if (index >= items.length) return
      try {
        results[index] = await task(items[index], index)
      } catch (error) {
        failed = true
        failure ??= error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  if (failed) throw failure
  return results
}

async function requestFrameAsset(url: string) {
  const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(120_000) })
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: unknown }
    throw new Error(typeof result.error === 'string' ? result.error : `Frame gagal dimuat (${response.status}).`)
  }
  const bytes = await response.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
  if (response.headers.get('x-frame-sha256') !== sha256) throw new Error('Hash PNG frame tidak cocok dengan server.')
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Gambar frame tidak dapat dibaca.'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Gambar frame tidak dapat dibaca.'))
    reader.readAsDataURL(new Blob([bytes], { type: 'image/png' }))
  })
}

const money = (value: number | string) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0)
const dateTime = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
const shortDate = (value: string) => new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(`${value}T12:00:00+07:00`))
const todayHeading = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date()).toLocaleUpperCase('id-ID')

function App() {
  const [identity, setIdentity] = useState<{ authenticated: boolean; email: string } | null>(null)
  const [checking, setChecking] = useState(true)
  useEffect(() => {
    request<{ authenticated: boolean; email: string }>('/api/me')
      .then(setIdentity)
      .catch(() => setIdentity({ authenticated: false, email: '' }))
      .finally(() => setChecking(false))
  }, [])
  if (checking) return <div className="screen-loading"><LoaderCircle className="spin" size={22} /> Memeriksa sesi admin</div>
  if (!identity?.authenticated) return <Login onLogin={setIdentity} />
  return <AdminShell email={identity.email} onLogout={() => setIdentity({ authenticated: false, email: '' })} />
}

function Login({ onLogin }: { onLogin: (user: { authenticated: boolean; email: string }) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await request<{ authenticated: boolean; email: string }>('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      onLogin(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Login tidak berhasil.')
    } finally {
      setBusy(false)
    }
  }
  return <main className="login-page">
    <section className="login-story">
      <div className="brand-lockup"><span className="brand-icon"><Camera size={20} /></span><span><b>CAPTURS</b><small>PHOTOBOOTH MANAGEMENT</small></span></div>
      <div className="story-copy"><span className="overline">Satu kendali untuk setiap momen</span><h1>Usahamu,<br /><em>lebih terlihat.</em></h1><p>Kelola booth dari mana saja. Pantau sesi, atur harga, dan pastikan setiap perangkat tetap siap.</p></div>
      <div className="story-foot"><span className="story-orbit orbit-one" /><span className="story-orbit orbit-two" /><div className="mini-photo"><span className="mini-spark">✳</span><span className="mini-frame"><i /><i /><i /></span><small>CAPTURS · JAKARTA</small></div><div className="floating-note"><span className="note-dot" /><span><b>Booth tersinkron</b><small>Laporan masuk otomatis</small></span><Check size={16} /></div><div className="story-credit">Dibuat untuk cerita yang tak terlupakan.</div></div>
    </section>
    <section className="login-form-wrap">
      <div className="login-mobile-brand"><span className="brand-icon"><Camera size={18} /></span><b>CAPTURS</b></div>
      <form className="login-form" onSubmit={(event) => { void submit(event) }}>
        <span className="login-kicker">SELAMAT DATANG KEMBALI</span><h2>Masuk ke web admin</h2><p>Gunakan akun admin Capturs Photobooth.</p>
        <label>Email admin<input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nama@email.com" required /></label>
        <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Masukkan password" required /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button login-submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : null}{busy ? 'Memeriksa…' : 'Masuk ke dashboard'}<ArrowRight size={16} /></button>
        <div className="secure-note"><ShieldCheck size={15} />Sesi login dilindungi cookie aman.</div>
      </form>
      <footer className="login-footer"><span>© 2026 Capturs Photobooth</span><a href="mailto:hello@capturs.id"><CircleHelp size={13} /> Bantuan</a></footer>
    </section>
  </main>
}

function AdminShell({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [view, setView] = useState<View>('overview')
  const [data, setData] = useState<DashboardData | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const settingsRef = useRef<Settings | null>(null)
  const settingsDeviceIdRef = useRef('')
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [devices, setDevices] = useState<Device[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [deviceRuns, setDeviceRuns] = useState<DeviceRun[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshDashboard = useCallback(async () => {
    setBusy(true)
    setLoadError('')
    try {
      setData(await request<DashboardData>('/api/dashboard'))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Dashboard gagal dimuat.')
    } finally {
      setBusy(false)
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    if (!selectedDeviceId) {
      settingsRef.current = null
      settingsDeviceIdRef.current = ''
      setSettings(null)
      setSettingsLoading(false)
      setSettingsError('')
      return
    }
    if (settingsDeviceIdRef.current !== selectedDeviceId) {
      settingsRef.current = null
      settingsDeviceIdRef.current = selectedDeviceId
    }
    const previous = settingsRef.current
    if (!previous) setSettingsLoading(true)
    try {
      const query = new URLSearchParams({ deviceId: selectedDeviceId })
      if (previous) {
        query.set('revision', String(previous.revision))
        query.set('frameRevision', String(previous.frameRevision))
      }
      const result = await request<{
        config?: Omit<Settings, 'boothFrames' | 'frameRevision'>
        frameRevision: number
        unchanged?: boolean
      }>(`/api/device-config?${query}`)
      if (settingsDeviceIdRef.current !== selectedDeviceId) return
      if (result.unchanged && previous) return
      if (!result.config) throw new Error('Konfigurasi booth tidak valid.')

      const frames: { manifest?: BoothFramesSettings; revision: number; unchanged?: boolean } = previous && previous.frameRevision === result.frameRevision
        ? { unchanged: true, revision: result.frameRevision }
        : await request<{ manifest?: BoothFramesSettings; revision: number; unchanged?: boolean }>(`/api/device-frames?deviceId=${encodeURIComponent(selectedDeviceId)}&revision=${previous?.frameRevision ?? 0}`)
      const next = {
        ...result.config,
        boothFrames: frames.unchanged && previous
          ? previous.boothFrames
          : serializeBoothFrameManifest(frames.manifest ?? { activeFrameId: '', frames: [] }),
        frameRevision: result.frameRevision ?? frames.revision,
      }
      settingsRef.current = next
      setSettings(next)
      setSettingsError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pengaturan gagal dimuat.'
      setSettingsError(message)
      setLoadError(message)
    } finally {
      setSettingsLoading(false)
    }
  }, [selectedDeviceId])

  const refreshDevices = useCallback(async () => {
    try {
      const result = await request<{ devices: Device[]; runs: DeviceRun[] }>('/api/devices')
      setDevices(result.devices)
      setDeviceRuns(result.runs)
      setSelectedDeviceId((current) => {
        const next = current && result.devices.some((device) => device._id === current && device.status === 'approved')
          ? current
          : result.devices.find((device) => device.status === 'approved')?._id ?? ''
        if (next !== current) {
          settingsRef.current = null
          settingsDeviceIdRef.current = next
        }
        return next
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Daftar booth gagal dimuat.')
    }
  }, [])

  const refreshPayments = useCallback(async () => {
    setPaymentsLoading(true)
    try {
      const result = await request<{ payments: Payment[] }>('/api/payments')
      setPayments(result.payments)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Daftar transaksi gagal dimuat.')
    } finally {
      setPaymentsLoading(false)
    }
  }, [])

  useEffect(() => { void refreshDashboard(); void refreshDevices(); void refreshPayments() }, [refreshDashboard, refreshDevices, refreshPayments])
  useEffect(() => {
    if (view !== 'settings' || !selectedDeviceId) return
    let refreshing = false
    const refreshVisibleSettings = async () => {
      if (refreshing || document.visibilityState !== 'visible') return
      refreshing = true
      try { await refreshSettings() } finally { refreshing = false }
    }
    void refreshVisibleSettings()
    const interval = window.setInterval(() => { void refreshVisibleSettings() }, 5_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshVisibleSettings()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [view, selectedDeviceId, refreshSettings])
  useEffect(() => {
    if (view !== 'booths') return
    void refreshDevices()
    const interval = window.setInterval(() => { void refreshDevices() }, 15_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshDevices()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [view, refreshDevices])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const signOut = async () => {
    await request('/api/logout', { method: 'POST' }).catch(() => undefined)
    onLogout()
  }

  const selectDevice = (deviceId: string) => {
    settingsRef.current = null
    settingsDeviceIdRef.current = deviceId
    setSettings(null)
    setSettingsLoading(true)
    setSettingsError('')
    setSelectedDeviceId(deviceId)
  }

  const storeName = data?.settings.storeName ?? settings?.storeName ?? 'Capturs Photobooth'
  const viewTitle: Record<View, string> = { overview: 'Ringkasan', sessions: 'Sesi foto', payments: 'Transaksi dibayar', booths: 'Perangkat booth', settings: 'Pengaturan booth', email: 'Email pelanggan', telegram: 'Telegram' }

  return <div className="admin-app">
    <aside className="sidebar">
      <div className="brand-lockup"><span className="brand-icon"><Camera size={19} /></span><span><b>CAPTURS</b><small>WEB ADMIN</small></span></div>
      <div className="store-switcher"><span className="store-avatar"><Store size={17} /></span><span><small>WORKSPACE TOKO</small><b>{storeName}</b></span><ChevronDown size={14} /></div>
      <div className="nav-caption">MENU UTAMA</div>
      <nav className="sidebar-nav">
        <NavButton active={view === 'overview'} icon={<LayoutDashboard size={17} />} title="Ringkasan" onClick={() => setView('overview')} />
        <NavButton active={view === 'sessions'} icon={<Activity size={17} />} title="Sesi foto" count={data?.metrics.sessionsToday} onClick={() => setView('sessions')} />
        <NavButton active={view === 'payments'} icon={<CreditCard size={17} />} title="Transaksi" count={payments.length} onClick={() => setView('payments')} />
        <NavButton active={view === 'booths'} icon={<Camera size={17} />} title="Perangkat booth" onClick={() => setView('booths')} />
        <NavButton active={view === 'settings'} icon={<Settings2 size={17} />} title="Pengaturan" onClick={() => setView('settings')} />
        <NavButton active={view === 'email'} icon={<Mail size={17} />} title="Email pelanggan" onClick={() => setView('email')} />
        <NavButton active={view === 'telegram'} icon={<Bell size={17} />} title="Telegram" onClick={() => setView('telegram')} />
      </nav>
      <div className="sidebar-spacer" />
      <div className="sync-card"><div className="sync-card-icon"><Cloud size={16} /></div><b>Booth terdeteksi otomatis</b><p>Setujui perangkat baru, lalu atur konfigurasinya sendiri.</p><span className="sync-card-status"><i /> {devices.filter((device) => device.status === 'approved').length} booth aktif</span></div>
      <div className="sidebar-user"><span className="user-avatar">{email.charAt(0).toUpperCase()}</span><span className="user-meta"><b>{email}</b><small>Administrator</small></span><button className="icon-button quiet" title="Keluar" onClick={() => { void signOut() }}><LogOut size={16} /></button></div>
    </aside>
    <main className="admin-main">
      <header className="topbar"><div><div className="breadcrumb">CAPTURS <span>/</span> WEB ADMIN</div><h1>{viewTitle[view]}</h1></div><div className="topbar-actions"><span className={`connection-chip ${loadError ? 'offline' : ''}`}><i />{loadError ? 'Periksa koneksi' : 'Semua sistem normal'}</span><button className="icon-button notification-button" title="Notifikasi"><Bell size={17} /><i /></button><button className="user-avatar top-avatar" onClick={() => { void signOut() }} title="Keluar">{email.charAt(0).toUpperCase()}</button></div></header>
      <div className="content-wrap">
        {loadError && <div className="error-banner"><WifiOff size={16} /><span>{loadError}</span><button onClick={() => { void refreshDashboard() }}>Coba lagi</button></div>}
        {view === 'overview' && <Overview data={data} loading={busy} onRefresh={() => { void refreshDashboard() }} onSessions={() => setView('sessions')} />}
        {view === 'sessions' && <SessionsPage sessions={data?.sessions ?? []} loading={busy} onRefresh={() => { void refreshDashboard() }} />}
        {view === 'payments' && <PaymentsPage payments={payments} loading={paymentsLoading} onRefresh={refreshPayments} />}
        {view === 'telegram' && <TelegramPage />}
        {view === 'email' && <EmailSettingsPage onSaved={(message) => setNotice(message)} />}
        {view === 'booths' && <><DevicesPage devices={devices} onRefresh={refreshDevices} onNotice={setNotice} onSelectDevice={(deviceId) => { selectDevice(deviceId); setView('settings') }} onApproved={async (deviceId) => { selectDevice(deviceId); await refreshDevices(); setView('settings') }} /><DeviceRunLog runs={deviceRuns} /></>}
        {view === 'settings' && settings && <SettingsPage devices={devices.filter((device) => device.status === 'approved')} selectedDeviceId={selectedDeviceId} onSelectDevice={selectDevice} value={settings} onSaved={(next) => { settingsRef.current = next; settingsDeviceIdRef.current = selectedDeviceId; setSettings(next); setNotice('Konfigurasi tersimpan. Booth masuk MAINTENANCE MODE setelah sesi selesai, lalu restart setelah semua sinkronisasi tuntas.'); void refreshDevices() }} />}
        {view === 'settings' && !settings && <div className="panel-loading">{settingsLoading ? <><LoaderCircle className="spin" /> Memuat konfigurasi booth…</> : settingsError ? <div className="settings-load-error"><b>Konfigurasi booth gagal dimuat</b><small>{settingsError}</small><button className="soft-button" onClick={() => { void refreshSettings() }}>Coba lagi</button></div> : selectedDeviceId ? <div className="settings-load-error"><b>Konfigurasi booth belum tersedia</b><button className="soft-button" onClick={() => { void refreshSettings() }}>Coba lagi</button></div> : <EmptyState icon={<Camera size={20} />} title="Belum ada booth aktif" text="Booth yang menghubungkan aplikasi desktop akan muncul di Perangkat Booth. Setujui perangkat tersebut untuk mulai mengatur konfigurasinya." />}</div>}
      </div>
      <footer className="page-footer"><span>Capturs Photobooth <i /> Panel web</span><span>ID toko · {data?.settings.storeId ?? '—'}</span></footer>
    </main>
    {notice && <div className="toast"><CheckCircle2 size={17} />{notice}</div>}
  </div>
}

function NavButton({ active, icon, title, count, onClick }: { active: boolean; icon: ReactNode; title: string; count?: number; onClick: () => void }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{title}</span>{count ? <small>{count}</small> : null}</button>
}

function EmailSettingsPage({ onSaved }: { onSaved: (message: string) => void }) {
  const [settings, setSettings] = useState<EmailSettings | null>(null)
  const [form, setForm] = useState<EmailSettingsForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await request<{ settings: EmailSettings }>('/api/email-settings')
      setSettings(result.settings)
      setForm({ ...result.settings, username: '', password: '' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pengaturan email gagal dimuat.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const patch = <K extends keyof EmailSettingsForm>(key: K, value: EmailSettingsForm[K]) => {
    setForm((current) => current ? { ...current, [key]: value } : current)
  }
  const changeMode = (mode: EmailSettingsForm['mode']) => {
    setForm((current) => current ? { ...current, mode, username: '', password: '', usernameConfigured: false, passwordConfigured: false } : current)
    setError('')
    setNotice('')
  }
  const dirty = Boolean(settings && form && (
    ['enabled', 'mode', 'smtpHost', 'smtpPort', 'smtpSecure', 'fromName', 'fromAddress']
      .some((key) => form[key as keyof EmailSettingsForm] !== settings[key as keyof EmailSettings])
    || form.username !== '' || form.password !== ''
  ))

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!settings || !form) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ settings: EmailSettings }>('/api/email-settings', {
        method: 'PUT',
        body: JSON.stringify({ ...form, expectedRevision: settings.revision }),
      })
      setSettings(result.settings)
      setForm({ ...result.settings, username: '', password: '' })
      setNotice('Pengaturan email berhasil disimpan.')
      onSaved('Pengaturan email pelanggan tersimpan di WebAdmin.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pengaturan email gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setError('')
    setNotice('Menguji koneksi dari WebAdmin...')
    try {
      const result = await request<{ message: string }>('/api/email-settings-test', { method: 'POST' })
      setNotice(result.message)
    } catch (reason) {
      setNotice('')
      setError(reason instanceof Error ? reason.message : 'Koneksi email gagal.')
    } finally {
      setTesting(false)
    }
  }

  if (loading && !form) return <div className="panel-loading"><LoaderCircle className="spin" /> Memuat pengaturan email...</div>
  if (!form || !settings) return <section className="panel settings-panel email-settings-page"><div className="form-error" role="alert">{error || 'Pengaturan email belum tersedia.'}</div><button className="secondary-button" onClick={() => { void refresh() }}><RefreshCw size={15} /> Coba lagi</button></section>

  return <>
    <div className="page-intro config-page-intro"><div><span className="page-eyebrow">PENGIRIMAN HASIL FOTO</span><h2>Email pelanggan</h2><p>Konfigurasi pengirim berlaku untuk semua booth di toko ini.</p></div><span className={`email-config-state ${settings.enabled ? 'active' : ''}`}><i />{settings.enabled ? 'PENGIRIMAN AKTIF' : 'PENGIRIMAN NONAKTIF'}</span></div>
    <form onSubmit={(event) => { void save(event) }} className="panel settings-panel email-settings-page">
      <div className="panel-heading"><div><span className="panel-kicker">KONEKSI EMAIL</span><h3>{form.mode === 'gmail' ? 'Gmail App Password' : 'Server SMTP'}</h3></div><span className="settings-icon pink"><Mail size={18} /></span></div>
      <p className="email-settings-intro">WebAdmin mengirim email setelah booth melaporkan bahwa upload Google Drive selesai. Kredensial email disimpan terenkripsi di server dan tidak dikirim ke booth.</p>
      <div className="settings-fields">
        <label>Metode pengiriman<select value={form.mode} onChange={(event) => changeMode(event.target.value as EmailSettingsForm['mode'])}><option value="smtp">SMTP kustom</option><option value="gmail">Gmail dengan App Password</option></select></label>
        <label className="config-checkbox"><input type="checkbox" checked={form.enabled} onChange={(event) => patch('enabled', event.target.checked)} /> Aktifkan email hasil foto untuk semua booth</label>
        {form.mode === 'smtp' ? <>
          <div className="email-settings-grid">
            <label>SMTP Host<input value={form.smtpHost} onChange={(event) => patch('smtpHost', event.target.value)} placeholder="smtp.example.com" /></label>
            <label>Port<input type="number" min="1" max="65535" value={form.smtpPort} onChange={(event) => patch('smtpPort', Number(event.target.value))} /></label>
            <label>Keamanan<select value={form.smtpSecure ? 'ssl' : 'starttls'} onChange={(event) => patch('smtpSecure', event.target.value === 'ssl')}><option value="starttls">STARTTLS · umumnya port 587</option><option value="ssl">SSL/TLS · umumnya port 465</option></select></label>
            <label>Email pengirim<input type="email" value={form.fromAddress} onChange={(event) => patch('fromAddress', event.target.value)} placeholder="foto@domainkamu.com" /></label>
          </div>
          <small className="settings-help">Untuk WebAdmin yang di-host di Vercel, port 25 diblokir. Gunakan port 587 STARTTLS atau 465 SSL/TLS jika penyedia mendukungnya.</small>
          <label>SMTP Username<input autoComplete="new-password" value={form.username} onChange={(event) => patch('username', event.target.value)} placeholder={form.usernameConfigured ? 'Tersimpan terenkripsi · isi untuk mengganti' : 'Username dari penyedia SMTP'} /></label>
          <label>SMTP Password / API key<input type="password" autoComplete="new-password" value={form.password} onChange={(event) => patch('password', event.target.value)} placeholder={form.passwordConfigured ? 'Tersimpan terenkripsi · isi untuk mengganti' : 'Password dari penyedia SMTP'} /></label>
        </> : <>
          <label>Akun Gmail / Google Workspace<input type="email" autoComplete="username" value={form.username} onChange={(event) => patch('username', event.target.value)} placeholder={form.usernameConfigured ? `Tersimpan: ${form.fromAddress} · isi untuk mengganti` : 'akun@gmail.com'} /></label>
          <label>Gmail App Password<input type="password" autoComplete="new-password" value={form.password} onChange={(event) => patch('password', event.target.value)} placeholder={form.passwordConfigured ? 'Tersimpan terenkripsi · isi untuk mengganti' : '16 karakter dari Google Account'} /></label>
          <small className="settings-help">Buat App Password di <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">Google Account</a>. Akun harus memakai 2-Step Verification. Masukkan App Password, bukan password utama; spasi akan dihapus otomatis. Google Workspace juga perlu mengizinkan App Password dari admin domain.</small>
        </>}
        <label>Nama pengirim<input value={form.fromName} onChange={(event) => patch('fromName', event.target.value)} maxLength={100} placeholder="Capturs Photobooth" /></label>
      </div>
      {error && <div className="form-error settings-error" role="alert">{error}</div>}
      {notice && <div className="telegram-save-notice" role="status">{notice}</div>}
      <div className="email-settings-actions"><button type="button" className="secondary-button" onClick={() => { void testConnection() }} disabled={testing || busy || dirty || !settings.usernameConfigured || !settings.passwordConfigured}><RefreshCw size={15} className={testing ? 'spin' : ''} /> Tes koneksi tersimpan</button>{dirty && <small>Simpan perubahan terlebih dahulu sebelum mengetes koneksi.</small>}</div>
      <div className="settings-save-row"><span>{dirty ? 'Ada perubahan yang belum disimpan.' : `Konfigurasi v${settings.revision} · diperbarui ${dateTime(settings.updatedAt)}`}</span><button type="submit" className="primary-button" disabled={busy || !dirty}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? 'Menyimpan...' : 'Simpan pengaturan email'}</button></div>
    </form>
  </>
}

function TelegramPage() {
  const [value, setValue] = useState<TelegramSettings | null>(null)
  const [chatId, setChatId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const chatIdEdited = useRef(false)

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    if (!quiet) setError('')
    try {
      const result = await request<TelegramSettings>('/api/telegram')
      setValue(result)
      if (!chatIdEdited.current) setChatId(result.chatId)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pengaturan Telegram gagal dimuat.')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const interval = window.setInterval(() => { void refresh(true) }, 15_000)
    return () => window.clearInterval(interval)
  }, [refresh])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await request<{ saved: boolean; chatId: string; updatedAt: string }>('/api/telegram', {
        method: 'PUT',
        body: JSON.stringify({ chatId }),
      })
      setValue((current) => current ? { ...current, chatId: result.chatId, updatedAt: result.updatedAt } : current)
      setChatId(result.chatId)
      chatIdEdited.current = false
      setNotice(result.chatId ? 'Chat ID Telegram tersimpan.' : 'Log Telegram dijeda.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pengaturan Telegram gagal disimpan.')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="page-intro config-page-intro">
      <div><span className="page-eyebrow">NOTIFIKASI WEBADMIN</span><h2>Telegram</h2><p>Atur chat tujuan untuk notifikasi sesi, pembayaran, konfigurasi, perangkat, dan perubahan frame.</p></div>
      <button className="secondary-button" onClick={() => { void refresh() }} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />Perbarui status</button>
    </div>
    {loading && !value ? <div className="panel-loading"><LoaderCircle className="spin" /> Memuat pengaturan Telegram…</div> : <section className="panel settings-panel telegram-settings-page">
      <div className="panel-heading"><div><span className="panel-kicker">STATUS BOT</span><h3>{value?.linked ? (value.deviceOnline ? 'Booth online' : 'Menunggu booth online') : 'Bot belum dihubungkan'}</h3></div><span className={`settings-icon ${value?.deviceOnline ? 'green' : 'blue'}`}><Bell size={18} /></span></div>
      <p>{value?.linked ? `Pengiriman berjalan lewat ${value.deviceName || 'booth yang terhubung'}. Token bot tetap disimpan di app desktop.` : 'Masukkan token bot di app desktop dan kirim /id dari chat tujuan. Setelah itu Chat ID bisa diatur di sini.'}</p>
      <form onSubmit={(event) => { void save(event) }} className="telegram-config-form">
        <div className="settings-fields"><label>Chat ID tujuan<input value={chatId} onChange={(event) => { setChatId(event.target.value); chatIdEdited.current = event.target.value !== (value?.chatId ?? '') }} placeholder="Kirim /id ke bot dari chat tujuan" disabled={!value?.linked || busy} /></label></div>
        <small className="settings-help">Kosongkan Chat ID dan simpan untuk menjeda notifikasi. Token tidak disimpan atau dikirim dari WebAdmin; token dikelola di app desktop.</small>
        {error && <div className="form-error settings-error" role="alert">{error}</div>}
        {notice && <div className="telegram-save-notice" role="status">{notice}</div>}
        <div className="settings-save-row"><span>{value?.updatedAt ? `Diperbarui ${dateTime(value.updatedAt)}` : 'Chat tujuan belum diatur'}</span><button type="submit" className="primary-button" disabled={!value?.linked || busy || chatId === (value?.chatId ?? '')}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? 'Menyimpan…' : 'Simpan Chat ID'}</button></div>
      </form>
    </section>}
  </>
}

function Overview({ data, loading, onRefresh, onSessions }: { data: DashboardData | null; loading: boolean; onRefresh: () => void; onSessions: () => void }) {
  const metrics = data?.metrics
  return <>
    <div className="welcome-row"><div><span className="page-eyebrow">{todayHeading}</span><h2>Halo, pemilik Capturs <span>✳</span></h2><p>Berikut yang terjadi di booth kamu hari ini.</p></div><button className="secondary-button" onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />Perbarui data</button></div>
    <section className="metric-grid">
      <MetricCard label="SESI HARI INI" value={String(metrics?.sessionsToday ?? '—')} note={`${metrics?.paidToday ?? 0} transaksi berbayar`} icon={<Camera size={18} />} tone="pink" trend="Aktivitas hari ini" />
      <MetricCard label="PENDAPATAN BULAN INI" value={money(metrics?.revenueMonth ?? 0)} note={`${metrics?.sessionsMonth ?? 0} sesi tercatat`} icon={<CreditCard size={18} />} tone="blue" trend="November 2026" />
      <MetricCard label="BOOTH ONLINE" value={`${metrics?.onlineBooths ?? 0} / ${metrics?.boothCount ?? 0}`} note="Terhubung dalam 2 menit terakhir" icon={<Wifi size={18} />} tone="green" trend="Status perangkat" />
    </section>
    <section className="dashboard-grid">
      <article className="panel revenue-panel"><div className="panel-heading"><div><span className="panel-kicker">PERFORMA TOKO</span><h3>Aktivitas 7 hari</h3></div><span className="range-chip">7 hari terakhir <ChevronDown size={13} /></span></div><ActivityChart values={data?.chart ?? []} /><div className="chart-legend"><span><i className="legend-sessions" /> Sesi selesai</span><span className="chart-caption">Waktu WIB · Asia/Jakarta</span></div></article>
      <article className="panel quick-panel"><div className="panel-heading"><div><span className="panel-kicker">RINGKASAN HARI INI</span><h3>Aktivitas terbaru</h3></div><button className="text-button" onClick={onSessions}>Semua sesi <ArrowRight size={14} /></button></div><div className="quick-list">{data?.sessions.slice(0, 4).map((session) => <SessionRow session={session} key={`${session.deviceName}-${session.sessionId}`} compact />)}{!data?.sessions.length && <EmptyState icon={<Camera size={19} />} title="Belum ada sesi" text="Sesi yang tersinkron akan muncul di sini." />}</div></article>
    </section>
    <section className="panel devices-summary"><div className="panel-heading"><div><span className="panel-kicker">PERANGKAT TERHUBUNG</span><h3>Booth Capturs</h3></div><button className="text-button" onClick={onSessions}>Lihat laporan <ArrowRight size={14} /></button></div><div className="booth-strip"><div className="booth-icon"><Camera size={20} /></div><div className="booth-summary"><b>{data?.settings.storeName ?? 'Capturs Photobooth'}</b><span>{metrics?.boothCount ?? 0} perangkat dipasangkan · {metrics?.onlineBooths ?? 0} online</span></div><div className="booth-health"><i /> Cloud siap</div></div></section>
  </>
}

function MetricCard({ label, value, note, icon, tone, trend }: { label: string; value: string; note: string; icon: React.ReactNode; tone: string; trend: string }) {
  return <article className="metric-card"><div className="metric-top"><span className={`metric-icon ${tone}`}>{icon}</span><span className="metric-trend">{tone === 'pink' ? <ArrowUpRight size={13} /> : tone === 'blue' ? <ArrowUpRight size={13} /> : <Activity size={13} />}{trend}</span></div><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-note">{note}</span></article>
}

function ActivityChart({ values }: { values: DashboardData['chart'] }) {
  const max = Math.max(1, ...values.map((point) => point.sessions))
  const points = values.map((point, index) => `${40 + index * 105},${160 - point.sessions / max * 112}`).join(' ')
  return <div className="chart-wrap"><div className="chart-y-labels"><span>{max}</span><span>{Math.ceil(max / 2)}</span><span>0</span></div><div className="chart-area"><svg viewBox="0 0 670 178" preserveAspectRatio="none" role="img" aria-label="Grafik jumlah sesi selama tujuh hari"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#fa699e" stopOpacity=".2" /><stop offset="100%" stopColor="#fa699e" stopOpacity="0" /></linearGradient></defs><path className="chart-gridline" d="M0 48H670M0 104H670M0 160H670" /><polygon points={`40,160 ${points} 670,160`} fill="url(#chart-fill)" /><polyline points={points} fill="none" stroke="#ed7ca2" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />{values.map((point, index) => <circle key={point.date} cx={40 + index * 105} cy={160 - point.sessions / max * 112} r="4" fill="#fff" stroke="#ed7ca2" strokeWidth="2.4" />)}</svg><div className="chart-x-labels">{values.map((point) => <span key={point.date}>{shortDate(point.date)}</span>)}</div></div></div>
}

function SessionsPage({ sessions, loading, onRefresh }: { sessions: Session[]; loading: boolean; onRefresh: () => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const rows = useMemo(() => sessions.filter((item) => `${item.sessionId} ${item.deviceName}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || item.paymentStatus === filter)), [sessions, query, filter])
  return <><div className="page-intro"><div><span className="page-eyebrow">LAPORAN TRANSAKSI</span><h2>Riwayat sesi foto</h2><p>Data sesi terbaru yang berhasil disinkronkan dari booth.</p></div><button className="secondary-button" onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />Segarkan</button></div><section className="panel table-panel"><div className="table-toolbar"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari ID sesi atau booth" /></label><select className="filter-select" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Semua status</option><option value="paid">Berbayar</option><option value="skipped">Dilewati</option><option value="event">Event</option></select></div><div className="table-scroll"><table><thead><tr><th>ID SESI</th><th>BOOTH</th><th>WAKTU</th><th>FORMAT</th><th>STATUS</th><th>EMAIL</th><th className="align-right">NILAI</th></tr></thead><tbody>{rows.map((session) => <SessionTableRow key={`${session.deviceName}-${session.sessionId}`} session={session} onRefresh={onRefresh} />)}</tbody></table>{!rows.length && <EmptyState icon={<Search size={18} />} title="Sesi tidak ditemukan" text="Coba ubah kata pencarian atau filter status." />}</div><div className="table-footer"><span>Menampilkan {rows.length} dari {sessions.length} sesi terbaru</span><span>Data berdasarkan WIB</span></div></section></>
}

function SessionRow({ session, compact = false }: { session: Session; compact?: boolean }) {
  return <div className={`session-row ${compact ? 'compact' : ''}`}><span className="session-thumb"><Camera size={16} /></span><span className="session-main"><b>{session.deviceName}</b><small>{dateTime(session.createdAt)} · {session.experience === 'strip' ? 'Photo strip' : 'Foto tunggal'}</small></span><span className="session-amount">{session.paymentStatus === 'paid' ? money(session.amount) : <StatusBadge status={session.paymentStatus} />}</span></div>
}

function SessionTableRow({ session, onRefresh }: { session: Session; onRefresh: () => void }) {
  const emailStatusLabel: Record<string, string> = { waiting_upload: 'Menunggu upload', sending: 'Mengirim', accepted: 'Diterima server', failed: 'Gagal', disabled: 'Nonaktif' }
  return <tr><td><span className="session-id">#{session.sessionId.slice(-12)}</span></td><td><span className="table-booth"><span className="table-booth-icon"><Camera size={14} /></span>{session.deviceName}</span></td><td>{dateTime(session.createdAt)}</td><td>{session.experience === 'strip' ? 'Photo strip' : 'Foto tunggal'}{session.sessionOutcome === 'partial' && <small className="table-subtext">Sesi parsial · {session.shotCount} foto</small>}{session.sessionOutcome === 'abandoned' && <small className="table-subtext">Tanpa foto</small>}</td><td><StatusBadge status={session.paymentStatus} /></td><td><small className={`email-status-label email-status-${session.emailStatus || 'disabled'}`}>{emailStatusLabel[session.emailStatus] ?? 'Belum tercatat'}</small>{session.emailError && <small className="email-status-error">{session.emailError}</small>}<RetryEmailAction session={{ sessionId: session.sessionId, deviceId: session.deviceId, customerEmail: session.customerEmail, driveUploaded: session.driveUploaded, driveLink: session.driveLink, emailStatus: session.emailStatus, sessionOutcome: session.sessionOutcome }} onRefresh={onRefresh} /></td><td className="align-right amount-cell">{session.paymentStatus === 'paid' ? money(session.amount) : '—'}</td></tr>
}

function RetryEmailAction({ session, onRefresh }: {
  session: { sessionId: string; deviceId: string; customerEmail: string; driveUploaded: boolean; driveLink: string; emailStatus: string; sessionOutcome: string }
  onRefresh: () => void
}) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const canRetry = ['failed', 'disabled'].includes(session.emailStatus) && Boolean(session.deviceId)
    && (session.sessionOutcome === 'abandoned' || session.driveUploaded && Boolean(session.driveLink))
  if (!canRetry && !retryError) return null
  const retryEmail = async () => {
    let customerEmail = session.customerEmail.trim()
    if (!customerEmail) {
      customerEmail = window.prompt(session.sessionOutcome === 'abandoned'
        ? 'Email sesi ini tidak tersedia. Masukkan email pelanggan untuk mengirim pemberitahuan timeout:'
        : 'Email sesi ini tidak tersedia. Masukkan email pelanggan untuk mengirim link Drive:')?.trim() ?? ''
      if (!customerEmail) return
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
        setRetryError('Format email pelanggan tidak valid.')
        return
      }
    }
    setRetrying(true)
    setRetryError('')
    try {
      await request('/api/email-retry', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, deviceId: session.deviceId, customerEmail }) })
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : 'Email gagal dikirim ulang.')
    } finally {
      await onRefresh()
      setRetrying(false)
    }
  }
  return <>{retryError && <small className="email-status-error">{retryError}</small>}{canRetry && <button className="email-retry-button" type="button" onClick={() => { void retryEmail() }} disabled={retrying}>{retrying ? 'Mengirim…' : 'Kirim ulang'}</button>}</>
}

function PaymentsPage({ payments, loading, onRefresh }: { payments: Payment[]; loading: boolean; onRefresh: () => void }) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => payments.filter((payment) => `${payment.paymentOrderId} ${payment.deviceName} ${payment.customerEmail} ${payment.paymentStatus} ${payment.sessionId}`.toLowerCase().includes(query.toLowerCase())), [payments, query])
  const emailStatusLabel: Record<string, string> = { waiting_upload: 'Menunggu upload', sending: 'Mengirim', accepted: 'Diterima server', failed: 'Gagal', disabled: 'Nonaktif' }
  return <>
    <div className="page-intro"><div><span className="page-eyebrow">PEMBAYARAN DAN SESI</span><h2>Transaksi</h2><p>Transaksi berbayar, sesi DEV tanpa pembayaran, dan sesi event.</p></div><button className="secondary-button" onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />Segarkan</button></div>
    <section className="panel table-panel">
      <div className="table-toolbar"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari ID pesanan, email, sesi, atau booth" /></label><span className="filter-select">{payments.length} catatan</span></div>
      <div className="table-scroll"><table><thead><tr><th>ID PESANAN / SESI</th><th>STATUS</th><th>BOOTH</th><th>WAKTU</th><th>EMAIL PELANGGAN</th><th>GOOGLE DRIVE</th><th className="align-right">NILAI</th></tr></thead><tbody>{rows.map((payment) => <tr key={payment.paymentOrderId || payment.sessionId}><td><span className="session-id">{payment.paymentOrderId || (payment.paymentStatus === 'event' ? 'Sesi event' : 'Sesi tanpa pembayaran')}</span><small className="table-subtext">{payment.paymentEnvironment === 'sandbox' ? 'Sandbox' : payment.paymentEnvironment === 'production' ? 'Production' : payment.operationMode === 'dev' ? 'DEV mode' : payment.operationMode === 'event' ? 'Event mode' : 'Env lama'}</small></td><td><StatusBadge status={payment.paymentStatus} /></td><td><span className="table-booth"><span className="table-booth-icon"><Camera size={14} /></span>{payment.deviceName}</span></td><td>{dateTime(payment.paidAt)}</td><td>{payment.customerEmail || 'Email tidak tersedia'}{payment.emailStatus && <small className={`email-status-label email-status-${payment.emailStatus}`} title={payment.emailError || undefined}>{emailStatusLabel[payment.emailStatus] ?? 'Belum tercatat'}</small>}{payment.emailError && <small className="email-status-error">{payment.emailError}</small>}{payment.sessionOutcome === 'abandoned' && <small className="table-subtext">Tidak ada foto</small>}<RetryEmailAction session={{ sessionId: payment.sessionId, deviceId: payment.deviceId, customerEmail: payment.customerEmail, driveUploaded: payment.driveUploaded, driveLink: payment.driveLink, emailStatus: payment.emailStatus, sessionOutcome: payment.sessionOutcome }} onRefresh={onRefresh} /></td><td>{payment.driveLink ? <><a className="table-link" href={payment.driveLink} target="_blank" rel="noreferrer">Buka folder <ArrowUpRight size={12} /></a>{payment.driveExpiresAt && <small className="table-subtext">Dijadwalkan hapus {dateTime(payment.driveExpiresAt)}</small>}</> : payment.sessionId ? payment.driveUploaded ? 'Upload selesai' : 'Tidak diunggah' : 'Menunggu sesi'}</td><td className="align-right amount-cell">{money(payment.amount)}</td></tr>)}</tbody></table>{!rows.length && <EmptyState icon={<CreditCard size={18} />} title="Belum ada transaksi atau sesi" text="Catatan akan muncul setelah sesi booth tersinkron ke WebAdmin." />}</div>
      <div className="table-footer"><span>Menampilkan {rows.length} dari {payments.length} catatan</span><span>Waktu WIB · Asia/Jakarta</span></div>
    </section>
  </>
}

function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = { paid: 'Berbayar', skipped: 'Dilewati', event: 'Event' }
  return <span className={`status-badge status-${status}`}><i />{label[status] ?? status}</span>
}

function DevicesPage({ devices, onRefresh, onNotice, onSelectDevice, onApproved }: {
  devices: Device[]
  onRefresh: () => Promise<void>
  onNotice: (message: string) => void
  onSelectDevice: (deviceId: string) => void
  onApproved: (deviceId: string) => Promise<void>
}) {
  const [busyId, setBusyId] = useState('')
  const approveDevice = async (device: Device) => {
    setBusyId(device._id)
    try {
      await request('/api/devices', { method: 'POST', body: JSON.stringify({ action: 'approve', deviceId: device._id }) })
      onNotice(`${device.name} disetujui dan konfigurasi lokalnya siap disinkronkan.`)
      await onApproved(device._id)
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : 'Booth gagal disetujui.')
    } finally {
      setBusyId('')
    }
  }
  const renameDevice = async (device: Device) => {
    const name = window.prompt('Nama booth', device.name)?.trim()
    if (!name || name === device.name) return
    try {
      await request('/api/devices', { method: 'POST', body: JSON.stringify({ action: 'rename', deviceId: device._id, name }) })
      await onRefresh()
      onNotice('Nama booth diperbarui.')
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : 'Nama booth gagal diperbarui.')
    }
  }
  const removeDevice = async (device: Device, permanent = false) => {
    const prompt = permanent
      ? `Hapus permanen entry ${device.name}? Riwayat sesi, transaksi, dan log aplikasi tetap disimpan.`
      : `Cabut akses ${device.name}? Booth ini tidak dapat sinkron sampai tersambung ulang.`
    if (!window.confirm(prompt)) return
    try {
      await request(`/api/devices?deviceId=${encodeURIComponent(device._id)}${permanent ? '&permanent=true' : ''}`, { method: 'DELETE' })
      await onRefresh()
      onNotice(permanent ? `${device.name} dihapus dari daftar; riwayat log tetap tersimpan.` : `Akses ${device.name} sudah dicabut.`)
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : permanent ? 'Entry booth gagal dihapus.' : 'Akses booth gagal dicabut.')
    }
  }
  return <>
    <div className="page-intro"><div><span className="page-eyebrow">MANAJEMEN PERANGKAT</span><h2>Booth yang terdeteksi</h2><p>Aplikasi mendaftarkan booth otomatis tanpa token API. Nama booth boleh sama; ID perangkat membedakan setiap booth.</p></div><button className="icon-button" title="Segarkan" onClick={() => { void onRefresh() }}><RefreshCw size={15} /></button></div>
    <section className="panel device-panel">
      <div className="panel-heading"><div><span className="panel-kicker">PERANGKAT TOKO</span><h3>{devices.filter((device) => device.status === 'approved').length} aktif · {devices.filter((device) => device.status === 'pending').length} menunggu</h3></div></div>
      {devices.length ? <div className="device-list">{devices.map((device) => {
        return <div className={`device-item ${device.status === 'pending' ? 'pending-device' : ''}`} key={device._id}>
          <span className="device-item-icon"><Camera size={19} /></span>
          <span className="device-details"><b>{device.name}</b><small>ID {device._id.slice(0, 8)} · terdeteksi {dateTime(device.createdAt)}{device.status === 'approved' ? ` · config v${device.configRevision}` : ''}</small></span>
          {device.status === 'pending'
            ? <button className="primary-button device-approve" disabled={busyId === device._id} onClick={() => { void approveDevice(device) }}>{busyId === device._id ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Setujui booth</button>
            : <span className={`device-online ${device.isOnline ? 'online' : ''}`}><i />{device.status === 'revoked' ? 'Dicabut' : device.isOnline ? 'Online' : 'Offline'}</span>}
          <span className="device-seen">{device.lastSeenAt ? `Terakhir aktif ${dateTime(device.lastSeenAt)}` : 'Menunggu koneksi pertama'}</span>
          {device.status === 'approved' && <button className="icon-button" title="Atur konfigurasi booth ini" onClick={() => onSelectDevice(device._id)}><Settings2 size={15} /></button>}
          <button className="icon-button" title="Ganti nama booth" onClick={() => { void renameDevice(device) }}><Pencil size={14} /></button>
          <button className="icon-button danger-quiet" title={device.status === 'revoked' ? 'Hapus entry permanen' : 'Cabut akses booth'} onClick={() => { void removeDevice(device, device.status === 'revoked') }}><Trash2 size={15} /></button>
        </div>
      })}</div> : <EmptyState icon={<Camera size={20} />} title="Belum ada booth terdeteksi" text="Simpan URL Web Admin di aplikasi desktop; booth akan muncul otomatis setelah mencoba sinkronisasi." />}
    </section>
  </>
}

function DeviceRunLog({ runs }: { runs: DeviceRun[] }) {
  return <section className="panel device-panel run-log-panel">
    <div className="panel-heading"><div><span className="panel-kicker">LOG APLIKASI</span><h3>Riwayat aplikasi dijalankan</h3></div><span className="range-chip">200 aktivitas terbaru</span></div>
    {runs.length ? <div className="device-list">{runs.map((run) => <div className="device-item run-item" key={run.runId}><span className="device-item-icon"><Activity size={17} /></span><span className="device-details"><b>{run.deviceName}</b><small>ID run {run.runId.slice(0, 8)}</small></span><span className="run-time">Mulai {dateTime(run.startedAt)}</span><span className="device-seen">Diterima server {dateTime(run.receivedAt)}</span></div>)}</div> : <EmptyState icon={<Activity size={19} />} title="Belum ada log aplikasi" text="Waktu mulai aplikasi dari booth akan tercatat setelah sinkronisasi aktif." />}
  </section>
}

function SettingsPage({ devices, selectedDeviceId, onSelectDevice, value, onSaved }: {
  devices: Device[]
  selectedDeviceId: string
  onSelectDevice: (deviceId: string) => void
  value: Settings
  onSaved: (settings: Settings) => void
}) {
  const [form, setForm] = useState(value)
  const formRef = useRef(form)
  const previousValueRef = useRef(value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editableKeys = ['storeName', 'photoStripPrice', 'singlePhotoPrice', 'sessionTimeoutMinutes', 'operationMode', 'paymentEnvironment', 'midtransClientKey', 'googleDriveEnabled', 'googleDriveRetentionDays', 'googleDriveFolder', 'cameraSettings', 'boothFrames'] as const
  useEffect(() => { formRef.current = form }, [form])
  useEffect(() => {
    const previousValue = previousValueRef.current
    const editedKeys = editableKeys.filter((key) => formRef.current[key] !== previousValue[key])
    setForm((current) => {
      const merged = { ...value }
      for (const key of editedKeys) Object.assign(merged, { [key]: current[key] })
      return merged
    })
    previousValueRef.current = value
  }, [value])
  const patch = <K extends keyof Settings>(key: K, next: Settings[K]) => setForm((current) => ({ ...current, [key]: next }))
  const boothFrames = useMemo(() => parseBoothFrames(form.boothFrames), [form.boothFrames])
  const loadFrameAsset = useCallback(async (frameId: string) => {
    const deviceQuery = `deviceId=${encodeURIComponent(selectedDeviceId)}&frameId=${encodeURIComponent(frameId)}&format=png`
    return requestFrameAsset(`/api/device-frames?${deviceQuery}`)
  }, [selectedDeviceId])
  const activeDevice = devices.find((device) => device._id === selectedDeviceId)
  const save = async (assets: BoothFrameAssetUpload[] = []) => {
    setBusy(true)
    setError('')
    try {
      const deviceId = selectedDeviceId
      const operationId = crypto.randomUUID()
      await request('/api/device-maintenance', {
        method: 'POST',
        body: JSON.stringify({ action: 'begin', deviceId, operationId }),
      })
      const heartbeatTimer = window.setInterval(() => {
        void request('/api/device-maintenance', {
          method: 'POST',
          body: JSON.stringify({ action: 'heartbeat', deviceId, operationId }),
        }).catch(() => {})
      }, 30_000)

      let savedSettings: Settings | null = null
      try {
        const deviceQuery = `deviceId=${encodeURIComponent(selectedDeviceId)}`
        let frameManifest = parseBoothFrames(form.boothFrames)
        let frameRevision = form.frameRevision
        if (assets.length || form.boothFrames !== value.boothFrames) {
          const knownHashes = new Set(parseBoothFrames(value.boothFrames).frames.map((frame) => frame.assetHash).filter((hash): hash is string => Boolean(hash)))
          const preparedAssets = await mapWithConcurrency(assets, 2, async (asset) => ({ asset, hash: await hashFrameDataUrl(asset.dataUrl) }))
          const uploadsByHash = new Map<string, BoothFrameAssetUpload>()
          for (const { asset, hash } of preparedAssets) {
            if (!knownHashes.has(hash) && !uploadsByHash.has(hash)) uploadsByHash.set(hash, asset)
          }
          await mapWithConcurrency([...uploadsByHash.entries()], 2, async ([expectedHash, asset]) => {
            const uploaded = await request<{ sha256: string }>(`/api/device-frames?${deviceQuery}&frameId=${encodeURIComponent(asset.frameId)}`, {
              method: 'PUT',
              body: JSON.stringify({ dataUrl: asset.dataUrl }),
              signal: AbortSignal.timeout(120_000),
            })
            if (uploaded.sha256 !== expectedHash) throw new Error('Hash PNG frame berubah saat diunggah.')
            knownHashes.add(expectedHash)
          })
          const hashesByFrameId = new Map(preparedAssets.map(({ asset, hash }) => [asset.frameId, hash]))
          frameManifest = {
            ...frameManifest,
            frames: frameManifest.frames.map((frame) => {
              const assetHash = hashesByFrameId.get(frame.id)
              return assetHash ? { ...frame, assetHash } : frame
            }),
          }
          const savedFrames = await request<{ manifest: BoothFramesSettings; revision: number }>(`/api/device-frames?${deviceQuery}`, {
            method: 'PUT', body: JSON.stringify({ manifest: frameManifest, expectedRevision: frameRevision }),
          })
          frameManifest = savedFrames.manifest
          frameRevision = savedFrames.revision
          setForm((current) => ({ ...current, boothFrames: serializeBoothFrameManifest(frameManifest), frameRevision }))
        }
        const config = {
          storeName: form.storeName,
          photoStripPrice: form.photoStripPrice,
          singlePhotoPrice: form.singlePhotoPrice,
          sessionTimeoutMinutes: form.sessionTimeoutMinutes,
          operationMode: form.operationMode,
          paymentEnvironment: form.paymentEnvironment,
          midtransClientKey: form.midtransClientKey,
          googleDriveEnabled: form.googleDriveEnabled,
          googleDriveRetentionDays: form.googleDriveRetentionDays,
          googleDriveFolder: form.googleDriveFolder,
          cameraSettings: form.cameraSettings,
        }
        const configKeys = ['storeName', 'photoStripPrice', 'singlePhotoPrice', 'sessionTimeoutMinutes', 'operationMode', 'paymentEnvironment', 'midtransClientKey', 'googleDriveEnabled', 'googleDriveRetentionDays', 'googleDriveFolder', 'cameraSettings'] as const
        const configDirty = configKeys.some((key) => form[key] !== value[key])
        let savedConfig: Omit<Settings, 'boothFrames' | 'frameRevision'> = form
        if (configDirty) {
          const body = JSON.stringify({ config, expectedRevision: value.revision })
          if (new Blob([body]).size > 4_200_000) throw new Error('Konfigurasi booth melewati batas request 4,2 MB.')
          const result = await request<{ config: Omit<Settings, 'boothFrames' | 'frameRevision'> }>(`/api/device-config?${deviceQuery}`, { method: 'PUT', body })
          savedConfig = result.config
        }
        savedSettings = { ...savedConfig, boothFrames: serializeBoothFrameManifest(frameManifest), frameRevision }
      } finally {
        window.clearInterval(heartbeatTimer)
        await request('/api/device-maintenance', {
          method: 'POST',
          body: JSON.stringify({ action: 'complete', deviceId, operationId }),
        })
      }
      if (!savedSettings) throw new Error('Perubahan booth tidak tersimpan.')
      onSaved(savedSettings)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pengaturan gagal disimpan.')
      return false
    } finally {
      setBusy(false)
    }
  }
  const dirty = editableKeys.some((key) => form[key] !== value[key])
  if (!selectedDeviceId || !activeDevice) return <div className="panel-loading"><EmptyState icon={<Camera size={20} />} title="Pilih booth aktif" text="Setujui perangkat di halaman Perangkat Booth, lalu pilih booth yang akan dikonfigurasi." /></div>
  return <>
    <div className="page-intro config-page-intro">
      <div><span className="page-eyebrow">KONFIGURASI PER PERANGKAT</span><h2>{activeDevice.name}</h2><p>Setelah sesi aktif selesai, booth masuk MAINTENANCE MODE, menyinkronkan perubahan dan antrean data, lalu restart otomatis.</p></div>
      <label className="device-config-select">Booth<select value={selectedDeviceId} onChange={(event) => onSelectDevice(event.target.value)}>{devices.map((device) => <option value={device._id} key={device._id}>{device.name}</option>)}</select></label>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void save() }} className="settings-layout device-config-layout">
      <div className="settings-column">
        <section className="panel settings-panel"><div className="panel-heading"><div><span className="panel-kicker">IDENTITAS DAN HARGA</span><h3>Profil booth</h3></div><span className="settings-icon pink"><Store size={18} /></span></div><div className="settings-fields"><label>Nama booth<input value={form.storeName} onChange={(event) => patch('storeName', event.target.value)} maxLength={100} required /></label><label>Harga photo strip<div className="price-entry"><span>Rp</span><input type="number" min="1" step="1" value={form.photoStripPrice} onChange={(event) => patch('photoStripPrice', event.target.value)} required /></div></label><label>Harga foto tunggal<div className="price-entry"><span>Rp</span><input type="number" min="1" step="1" value={form.singlePhotoPrice} onChange={(event) => patch('singlePhotoPrice', event.target.value)} required /></div><small>Harga tiap format diatur terpisah.</small></label><label>Batas waktu sesi (menit)<input type="number" min="1" max="60" step="1" value={form.sessionTimeoutMinutes} onChange={(event) => patch('sessionTimeoutMinutes', event.target.value)} required /><small>Timer mulai setelah pembayaran berhasil.</small></label></div></section>
        <section className="panel settings-panel"><div className="panel-heading"><div><span className="panel-kicker">MODE OPERASIONAL</span><h3>Pembayaran dan sesi</h3></div><span className="settings-icon blue"><Settings2 size={18} /></span></div><div className="mode-options">{(['dev', 'booth', 'event'] as const).map((mode) => <button type="button" className={`mode-option ${form.operationMode === mode ? 'selected' : ''}`} onClick={() => patch('operationMode', mode)} key={mode}><span className="radio-dot" /><span><b>{mode === 'dev' ? 'DEV mode' : mode === 'booth' ? 'Booth mode' : 'Event mode'}</b><small>{mode === 'dev' ? 'Uji coba dan pembayaran dapat dilewati.' : mode === 'booth' ? 'Pelanggan wajib membayar melalui Midtrans.' : 'Pembayaran sudah ditanggung penyelenggara.'}</small></span><span className={`mode-tag ${mode}`}>{mode === 'dev' ? 'TEST' : mode === 'booth' ? 'LIVE' : 'EVENT'}</span></button>)}</div></section>
        <section className="panel settings-panel"><div className="panel-heading"><div><span className="panel-kicker">PAYMENT GATEWAY</span><h3>Midtrans</h3></div><span className="settings-icon lavender"><CreditCard size={18} /></span></div><div className="settings-fields"><label>Environment<select value={form.paymentEnvironment} onChange={(event) => patch('paymentEnvironment', event.target.value as Settings['paymentEnvironment'])}><option value="sandbox">Sandbox · transaksi uji coba</option><option value="production">Production · transaksi asli</option></select></label><label>Client Key<input value={form.midtransClientKey} onChange={(event) => patch('midtransClientKey', event.target.value)} placeholder="SB-Mid-client-…" /></label></div><div className="info-callout"><ShieldCheck size={16} /><span><b>Server Key tetap lokal.</b><small>Web Admin mengubah Client Key dan environment. Server Key tetap terenkripsi di booth.</small></span></div></section>
        <section className="panel settings-panel"><div className="panel-heading"><div><span className="panel-kicker">UPLOAD DRIVE</span><h3>Tujuan upload</h3></div><span className="settings-icon green"><Cloud size={18} /></span></div><div className="settings-fields"><label className="config-checkbox"><input type="checkbox" checked={form.googleDriveEnabled === 'true'} onChange={(event) => patch('googleDriveEnabled', event.target.checked ? 'true' : 'false')} /> Aktifkan upload otomatis</label><label>Folder di Google Drive<input value={form.googleDriveFolder} onChange={(event) => patch('googleDriveFolder', event.target.value)} placeholder="Capturs" /><small>Folder dibuat otomatis. Gunakan / untuk membuat subfolder.</small></label><label>Simpan di Drive selama (hari)<input type="number" min="1" max="3650" step="1" value={form.googleDriveRetentionDays} onChange={(event) => patch('googleDriveRetentionDays', event.target.value)} required /><small>Berlaku untuk upload baru. Sesi yang sudah diunggah mengikuti masa retensi saat upload.</small></label></div><p className="settings-help">Akun Google dan OAuth tersimpan lokal pada booth. WebAdmin hanya mengatur tujuan dan lama penyimpanan.</p></section>
      </div>
      <div className="settings-column">
        <section className="panel settings-panel"><div className="panel-heading"><div><span className="panel-kicker">KAMERA</span><h3>Pengaturan kamera booth</h3></div><span className="settings-icon blue"><Camera size={18} /></span></div><label className="json-config-field">Pengaturan kamera (JSON)<textarea spellCheck={false} value={form.cameraSettings} onChange={(event) => patch('cameraSettings', event.target.value)} /></label><small className="settings-help">Pengaturan dari admin lokal akan tersimpan dan dapat diteruskan ke booth yang dipilih. Kamera dan kontrol ini tidak memengaruhi perangkat yang digunakan browser.</small></section>
        <BoothFramesPanel settings={boothFrames} onChange={(next: BoothFramesSettings) => patch('boothFrames', serializeBoothFrameManifest(next))} onSave={save} loadFrameAsset={loadFrameAsset} />
        <section className="panel settings-panel cloud-settings"><div className="panel-heading"><div><span className="panel-kicker">TARGET PERUBAHAN</span><h3>{activeDevice.name}</h3></div><span className="settings-icon green"><Cloud size={18} /></span></div><p>Frame, harga, mode, kamera, dan pengaturan upload ini hanya untuk booth terpilih. Setelah sesi dan halaman cetak selesai, booth menyinkronkan perubahan dalam MAINTENANCE MODE lalu restart otomatis.</p></section>
        {error && <div className="form-error settings-error">{error}</div>}
        <div className="settings-save-row"><span>{dirty ? 'Ada perubahan yang belum disimpan.' : `Konfigurasi v${value.revision} · diperbarui ${dateTime(value.updatedAt)}`}</span><button type="submit" className="primary-button" disabled={busy || !dirty}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{busy ? 'Menyimpan…' : 'Simpan untuk booth ini'}</button></div>
      </div>
    </form>
  </>
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="empty-state"><span>{icon}</span><b>{title}</b><small>{text}</small></div>
}

export default App
