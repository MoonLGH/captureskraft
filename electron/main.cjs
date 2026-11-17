const { app, BrowserWindow, dialog, ipcMain, safeStorage, session } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const verifiedPaymentOrders = new Map()

const secretFields = ['mongoUri', 'midtransServerKey']
const rendererSecretFields = ['mongoUri']
const allowedFields = [
  'storeName', 'storeId', 'price', 'mongoUri', 'syncUrl', 'storagePath',
  'operationMode', 'paymentEnvironment', 'midtransClientKey', 'midtransServerKey',
  'rcloneEnabled', 'rcloneExecutable', 'rcloneRemote', 'rcloneFolder', 'rcloneConfigPath',
  'cameraSettings',
  'boothFrames',
]

function isTrustedRenderer(event) {
  const url = event.senderFrame?.url ?? ''
  return url.startsWith('file://') || url.startsWith('http://127.0.0.1:5173/')
}

function configPath() {
  return path.join(app.getPath('documents'), 'Capturs', 'config', 'store-config.json')
}

function legacyConfigPath() {
  return path.join(app.getPath('userData'), 'store-config.json')
}

function defaultSessionStoragePath() {
  return path.join(app.getPath('documents'), 'Capturs', 'storage')
}

async function ensureCaptursDirectories() {
  await Promise.all([
    fs.mkdir(path.dirname(configPath()), { recursive: true }),
    fs.mkdir(defaultSessionStoragePath(), { recursive: true }),
  ])
}

function normalizeStoragePath(value) {
  return typeof value === 'string' && value.trim()
    ? path.resolve(value.trim())
    : defaultSessionStoragePath()
}

async function readStoredConfig() {
  try {
    return JSON.parse(await fs.readFile(configPath(), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  try {
    const legacyConfig = await fs.readFile(legacyConfigPath())
    const parsed = JSON.parse(legacyConfig.toString('utf8'))
    await fs.mkdir(path.dirname(configPath()), { recursive: true })
    await fs.writeFile(configPath(), legacyConfig)
    return parsed
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function sessionStoragePath() {
  const saved = await readStoredConfig()
  return normalizeStoragePath(saved?.public?.storagePath)
}

async function decryptStoredString(encrypted) {
  let decrypted = await safeStorage.decryptStringAsync(encrypted)
  if (typeof decrypted !== 'string' && decrypted?.shouldReEncrypt) {
    decrypted = await safeStorage.decryptStringAsync(encrypted)
  }

  const value = typeof decrypted === 'string' ? decrypted : decrypted?.result
  if (typeof value !== 'string') throw new Error('Rahasia tidak dapat dibaca dari penyimpanan aman.')
  return value
}

async function midtransServerKey(saved) {
  const encrypted = saved?.secrets?.midtransServerKey
  if (!encrypted) throw new Error('Server Key Midtrans belum diatur di Admin Settings.')
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error('Penyimpanan aman sistem operasi tidak tersedia untuk membaca Server Key.')
  }
  const serverKey = await decryptStoredString(Buffer.from(encrypted, 'base64'))
  const expectedPrefix = saved?.public?.paymentEnvironment === 'production' ? 'Mid-server-' : 'SB-Mid-server-'
  if (!serverKey.startsWith(expectedPrefix)) {
    const environment = saved?.public?.paymentEnvironment === 'production' ? 'Production' : 'Sandbox'
    throw new Error(`Server Key tidak cocok dengan format ${environment}. Tempel Server Key mentah, bukan Client Key atau hasil Base64.`)
  }
  return serverKey
}

function midtransBaseUrl(saved) {
  return saved?.public?.paymentEnvironment === 'production'
    ? 'https://api.midtrans.com'
    : 'https://api.sandbox.midtrans.com'
}

function midtransSnapBaseUrl(saved) {
  return saved?.public?.paymentEnvironment === 'production'
    ? 'https://app.midtrans.com'
    : 'https://app.sandbox.midtrans.com'
}

async function requestMidtrans(saved, url, options = {}) {
  const serverKey = await midtransServerKey(saved)
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(20000),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    const details = Array.isArray(result.error_messages) ? result.error_messages.join(' ') : result.status_message
    if (response.status === 401) {
      const environment = saved?.public?.paymentEnvironment === 'production' ? 'Production' : 'Sandbox'
      throw new Error(`Midtrans menolak autentikasi ${environment}. Pastikan Server Key mentah berasal dari merchant dan environment yang sama dengan Client Key. Jangan tempel Client Key atau key yang sudah di-Base64; aplikasi membuat Basic Auth otomatis.${details ? ` Detail: ${details}` : ''}`)
    }
    throw new Error(details || `Midtrans merespons HTTP ${response.status}.`)
  }
  return result
}

function validateCustomer(customer) {
  const name = typeof customer?.name === 'string' ? customer.name.trim() : ''
  const email = typeof customer?.email === 'string' ? customer.email.trim() : ''
  if (!name || name.length > 100) throw new Error('Nama pelanggan tidak valid.')
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email pelanggan tidak valid.')
  return { name, email }
}

function rcloneArguments(settings, command, sourcePath) {
  const executable = typeof settings?.executable === 'string' && settings.executable.trim()
    ? settings.executable.trim()
    : 'rclone'
  const remote = typeof settings?.remote === 'string' ? settings.remote.trim() : ''
  const folder = typeof settings?.folder === 'string' ? settings.folder.trim().replace(/^\/+|\/+$/g, '') : ''
  const configPathValue = typeof settings?.configPath === 'string' ? settings.configPath.trim() : ''
  if (!/^[a-zA-Z0-9_.-]+$/.test(remote)) throw new Error('Nama remote rclone harus diisi dan hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung.')
  if (folder.split(/[\\/]+/).some((part) => part === '..') || folder.includes(':')) throw new Error('Folder tujuan rclone tidak valid.')
  const args = configPathValue ? ['--config', path.resolve(configPathValue)] : []
  if (command === 'copy') {
    if (!sourcePath) throw new Error('Folder sesi lokal tidak tersedia untuk backup.')
    const remotePath = `${remote}:${folder ? `${folder}/` : ''}${path.basename(sourcePath)}`
    args.push('copy', sourcePath, remotePath)
  } else {
    args.push('lsd', `${remote}:`)
  }
  return { executable, args }
}

async function runRclone(settings, command, sourcePath) {
  const { executable, args } = rcloneArguments(settings, command, sourcePath)
  return execFileAsync(executable, args, { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true })
}

function timestampFolderName(date = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`
}

function validateSessionFiles(files) {
  if (!Array.isArray(files) || files.length < 3 || files.length > 32) {
    throw new Error('Isi file sesi tidak valid.')
  }

  const seen = new Set()
  let totalBytes = 0
  const normalized = files.map((file) => {
    const name = typeof file?.name === 'string' ? file.name : ''
    if (!/^(Hasil\.png|Boomerang\.gif|Foto \d{2}\.png)$/.test(name) || seen.has(name)) {
      throw new Error('Nama file sesi tidak valid.')
    }
    if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength === 0 || file.bytes.byteLength > 64 * 1024 * 1024) {
      throw new Error('Ukuran file sesi tidak valid.')
    }
    seen.add(name)
    totalBytes += file.bytes.byteLength
    if (name.endsWith('.png') && (
      file.bytes[0] !== 0x89 || file.bytes[1] !== 0x50 || file.bytes[2] !== 0x4e || file.bytes[3] !== 0x47
    )) throw new Error('Format PNG sesi tidak valid.')
    if (name === 'Boomerang.gif' && (
      file.bytes[0] !== 0x47 || file.bytes[1] !== 0x49 || file.bytes[2] !== 0x46
    )) throw new Error('Format GIF sesi tidak valid.')
    return { name, bytes: Buffer.from(file.bytes) }
  })

  if (totalBytes > 256 * 1024 * 1024 || !seen.has('Hasil.png') || !seen.has('Boomerang.gif') || ![...seen].some((name) => name.startsWith('Foto '))) {
    throw new Error('File hasil sesi belum lengkap.')
  }
  return normalized
}

function validateSessionMetadata(metadata) {
  const customer = validateCustomer({ name: metadata?.customerName, email: metadata?.customerEmail })
  const operationMode = metadata?.operationMode
  const paymentStatus = metadata?.paymentStatus
  const experience = metadata?.experience
  if (!['dev', 'booth', 'event'].includes(operationMode) || !['single', 'strip'].includes(experience)) {
    throw new Error('Informasi sesi tidak valid.')
  }
  if (operationMode === 'event' && paymentStatus !== 'event') throw new Error('Status pembayaran sesi event tidak valid.')
  if (operationMode === 'dev' && !['paid', 'skipped'].includes(paymentStatus)) throw new Error('Status pembayaran sesi developer tidak valid.')
  if (operationMode === 'booth' && paymentStatus !== 'paid') throw new Error('Pembayaran wajib untuk sesi booth normal.')
  const paymentOrderId = typeof metadata.paymentOrderId === 'string' ? metadata.paymentOrderId.trim().slice(0, 100) : ''
  if (paymentStatus === 'paid' && !paymentOrderId) throw new Error('ID transaksi pembayaran tidak tersedia.')
  return { ...customer, operationMode, paymentStatus, paymentOrderId, experience }
}

function sessionPrice(savedConfig, experience) {
  const basePrice = Number(savedConfig?.public?.price) || 35000
  return experience === 'single' ? Math.round(basePrice * 0.7) : basePrice
}

async function saveSession(event, payload) {
  if (!isTrustedRenderer(event)) throw new Error('Akses penyimpanan sesi ditolak.')
  const normalizedFiles = validateSessionFiles(payload?.files)
  const metadata = validateSessionMetadata(payload?.metadata)
  const savedConfig = await readStoredConfig()
  const configuredMode = ['dev', 'booth', 'event'].includes(savedConfig?.public?.operationMode)
    ? savedConfig.public.operationMode
    : 'dev'
  if (metadata.operationMode !== configuredMode) throw new Error('Mode booth berubah. Silakan mulai sesi baru.')
  if (metadata.paymentStatus === 'paid') {
    const payment = verifiedPaymentOrders.get(metadata.paymentOrderId)
    if (!payment?.verified || payment.amount !== sessionPrice(savedConfig, metadata.experience)) {
      throw new Error('Pembayaran sesi belum terverifikasi untuk jumlah yang sesuai.')
    }
  }
  const root = await sessionStoragePath()
  await fs.mkdir(root, { recursive: true })

  const baseName = timestampFolderName()
  let directoryName = baseName
  for (let suffix = 1; ; suffix += 1) {
    try {
      await fs.access(path.join(root, directoryName))
      directoryName = `${baseName}-${String(suffix).padStart(2, '0')}`
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      break
    }
  }

  const pendingPath = path.join(root, `.pending-${randomUUID()}`)
  const directoryPath = path.join(root, directoryName)
  await fs.mkdir(pendingPath)
  try {
    const sessionMetadata = { ...metadata, sessionId: directoryName, createdAt: new Date().toISOString() }
    await Promise.all([
      ...normalizedFiles.map(({ name, bytes }) => fs.writeFile(path.join(pendingPath, name), bytes, { flag: 'wx' })),
      fs.writeFile(path.join(pendingPath, 'info.json'), JSON.stringify(sessionMetadata, null, 2), { flag: 'wx' }),
    ])
    await fs.rename(pendingPath, directoryPath)
    if (metadata.paymentStatus === 'paid') verifiedPaymentOrders.delete(metadata.paymentOrderId)
  } catch (error) {
    await fs.rm(pendingPath, { recursive: true, force: true })
    throw error
  }

  let backupSent = false
  let backupError = ''
  if (savedConfig?.public?.rcloneEnabled === 'true') {
    try {
      const settings = {
        executable: savedConfig.public.rcloneExecutable,
        remote: savedConfig.public.rcloneRemote,
        folder: savedConfig.public.rcloneFolder,
        configPath: savedConfig.public.rcloneConfigPath,
      }
      await runRclone(settings, 'copy', directoryPath)
      backupSent = true
    } catch (error) {
      backupError = error instanceof Error ? error.message : 'Backup rclone gagal.'
    }
  }

  return { saved: true, directory: directoryPath, backupSent, backupError }
}

async function loadConfig(event) {
  if (!isTrustedRenderer(event)) throw new Error('Akses konfigurasi ditolak.')
  try {
    await ensureCaptursDirectories()
    const saved = await readStoredConfig()
    if (!saved) return {
      storagePath: defaultSessionStoragePath(),
      midtransServerKey: '',
      midtransServerKeyConfigured: false,
    }
    const config = Object.fromEntries(
      allowedFields
        .filter((field) => saved.public?.[field] !== undefined)
        .map((field) => [field, saved.public[field]]),
    )
    const encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable()
    if (saved.secrets && encryptionAvailable) {
      for (const field of rendererSecretFields) {
        const encrypted = saved.secrets[field]
        if (encrypted) config[field] = await decryptStoredString(Buffer.from(encrypted, 'base64'))
      }
    }
    config.midtransServerKey = ''
    config.midtransServerKeyConfigured = Boolean(saved.secrets?.midtransServerKey && encryptionAvailable)
    config.storagePath = normalizeStoragePath(config.storagePath)
    return config
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

async function saveConfig(event, input) {
  if (!isTrustedRenderer(event)) throw new Error('Akses konfigurasi ditolak.')
  const previous = await readStoredConfig()
  const config = Object.fromEntries(allowedFields.map((field) => [field, String(input?.[field] ?? '')]))
  config.midtransServerKey = config.midtransServerKey.trim()
  config.storagePath = normalizeStoragePath(config.storagePath)
  const encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable()
  if (!encryptionAvailable && secretFields.some((field) => config[field])) {
    throw new Error('Penyimpanan terenkripsi dari sistem operasi tidak tersedia.')
  }
  const publicConfig = { ...config }
  const secrets = {}
  for (const field of secretFields) {
    delete publicConfig[field]
    if (field === 'midtransServerKey' && !config[field] && previous?.secrets?.[field]) {
      secrets[field] = previous.secrets[field]
      continue
    }
    secrets[field] = config[field]
      ? (await safeStorage.encryptStringAsync(config[field])).toString('base64')
      : ''
  }
  await fs.mkdir(path.dirname(configPath()), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify({ public: publicConfig, secrets }, null, 2), 'utf8')
  return { saved: true }
}

async function chooseStoragePath(event) {
  if (!isTrustedRenderer(event)) throw new Error('Akses pemilih folder ditolak.')
  const currentPath = await sessionStoragePath()
  const defaultPath = await fs.stat(currentPath).then((stats) => stats.isDirectory() ? currentPath : defaultSessionStoragePath()).catch(() => defaultSessionStoragePath())
  const owner = BrowserWindow.fromWebContents(event.sender)
  const options = {
    title: 'Pilih folder penyimpanan foto',
    defaultPath,
    properties: ['openDirectory'],
  }
  const selection = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  return { canceled: selection.canceled, path: selection.filePaths[0] ?? '' }
}

async function createMidtransPayment(event, input) {
  if (!isTrustedRenderer(event)) throw new Error('Akses pembayaran ditolak.')
  const saved = await readStoredConfig()
  const operationMode = saved?.public?.operationMode ?? 'dev'
  if (!['dev', 'booth'].includes(operationMode)) throw new Error('Pembayaran hanya tersedia pada DEV mode dan Booth mode.')
  if (!saved?.public?.midtransClientKey) throw new Error('Client Key Midtrans belum diatur di Admin Settings.')
  const experience = input?.experience
  if (!['single', 'strip'].includes(experience)) throw new Error('Format sesi pembayaran tidak valid.')
  const amount = Number(input?.amount)
  const expectedAmount = sessionPrice(saved, experience)
  if (!Number.isSafeInteger(amount) || amount !== expectedAmount || amount < 1) throw new Error('Total pembayaran tidak sesuai dengan harga sesi di pengaturan booth.')
  const orderId = `CAPTURS-${Date.now()}-${randomUUID().slice(0, 8)}`
  verifiedPaymentOrders.set(orderId, { amount, verified: false, createdAt: Date.now() })
  let result
  try {
    result = await requestMidtrans(saved, `${midtransSnapBaseUrl(saved)}/snap/v1/transactions`, {
      method: 'POST',
      body: JSON.stringify({ transaction_details: { order_id: orderId, gross_amount: amount } }),
    })
  } catch (error) {
    verifiedPaymentOrders.delete(orderId)
    throw error
  }
  const token = typeof result.token === 'string' ? result.token : ''
  if (!token) {
    verifiedPaymentOrders.delete(orderId)
    throw new Error('Midtrans tidak mengembalikan Snap token.')
  }
  return { token, orderId }
}

async function verifyMidtransPayment(event, orderId) {
  if (!isTrustedRenderer(event)) throw new Error('Akses verifikasi pembayaran ditolak.')
  const saved = await readStoredConfig()
  const operationMode = saved?.public?.operationMode ?? 'dev'
  if (!['dev', 'booth'].includes(operationMode)) throw new Error('Verifikasi pembayaran hanya tersedia pada DEV mode dan Booth mode.')
  if (typeof orderId !== 'string' || !/^CAPTURS-[\w-]{8,100}$/.test(orderId)) throw new Error('ID pembayaran tidak valid.')
  const payment = verifiedPaymentOrders.get(orderId)
  if (!payment) throw new Error('ID pembayaran tidak dibuat oleh sesi booth ini.')
  if (Date.now() - payment.createdAt > 30 * 60 * 1000) {
    verifiedPaymentOrders.delete(orderId)
    throw new Error('Sesi pembayaran kedaluwarsa. Silakan mulai pembayaran lagi.')
  }
  const result = await requestMidtrans(saved, `${midtransBaseUrl(saved)}/v2/${encodeURIComponent(orderId)}/status`, {
    method: 'GET',
  })
  if (Number(result.gross_amount) !== payment.amount) {
    throw new Error('Nominal transaksi tidak sesuai dengan harga sesi booth.')
  }
  const status = typeof result.transaction_status === 'string' ? result.transaction_status : 'unknown'
  const paid = status === 'settlement' || (status === 'capture' && result.fraud_status === 'accept')
  if (paid) payment.verified = true
  const terminal = ['deny', 'cancel', 'expire', 'failure', 'refund', 'partial_refund', 'chargeback'].includes(status)
  if (terminal) verifiedPaymentOrders.delete(orderId)
  return { paid, status, terminal }
}

async function testRclone(event, settings) {
  if (!isTrustedRenderer(event)) throw new Error('Akses pengujian rclone ditolak.')
  try {
    await runRclone(settings, 'test')
    return { message: 'Koneksi rclone berhasil.' }
  } catch (error) {
    throw new Error(error.message || 'Koneksi rclone gagal. Periksa executable, remote, dan file konfigurasi rclone.')
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#ffe7f0',
    autoHideMenuBar: true,
    fullscreen: app.isPackaged,
    kiosk: app.isPackaged,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith('file://') || url.startsWith('http://127.0.0.1:5173/')
    if (!isLocal) event.preventDefault()
  })

  if (app.isPackaged) window.loadFile(path.join(__dirname, '../dist/index.html'))
  else window.loadURL('http://127.0.0.1:5173')
}

app.whenReady().then(async () => {
  await ensureCaptursDirectories()
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const videoOnly = permission === 'media'
      && details.mediaTypes?.includes('video')
      && !details.mediaTypes?.includes('audio')
    callback(Boolean(videoOnly))
  })
  ipcMain.handle('config:load', loadConfig)
  ipcMain.handle('config:save', saveConfig)
  ipcMain.handle('session:save', saveSession)
  ipcMain.handle('storage:choose-path', chooseStoragePath)
  ipcMain.handle('payment:create-midtrans', createMidtransPayment)
  ipcMain.handle('payment:verify-midtrans', verifyMidtransPayment)
  ipcMain.handle('rclone:test', testRclone)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
