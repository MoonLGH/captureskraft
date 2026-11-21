const { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, session, shell } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID, createHash, generateKeyPairSync, sign } = require('node:crypto')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const {
  authorizeGoogleDrive,
  createSessionFolder,
  deleteSessionFolder,
  getGoogleDriveAccountEmail,
  shareSessionFolder,
  uploadSessionFiles,
} = require('./google-drive.cjs')
const { createTelegramBot } = require('../tele/bot.cjs')

const verifiedPaymentOrders = new Map()
const appRun = { runId: randomUUID(), startedAt: new Date().toISOString() }
let appRunQueued = false
let legacyCustomerEmailRepairQueued = false

async function runWithConcurrency(items, limit, task) {
  const results = new Array(items.length)
  let nextIndex = 0
  let failed = false
  let failure
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

const secretFields = ['mongoUri', 'midtransServerKey', 'syncToken', 'telegramBotToken']
const defaultDriveRetentionDays = 7
const maxDriveRetentionDays = 3650
const maxDriveRetentionEntries = 25000
const driveRetentionDayMs = 24 * 60 * 60 * 1000
const rendererSecretFields = ['mongoUri']
const allowedFields = [
  'storeName', 'storeId', 'photoStripPrice', 'singlePhotoPrice', 'sessionTimeoutMinutes', 'mongoUri', 'syncUrl', 'syncToken', 'storagePath', 'telegramBotToken', 'telegramChatId',
  'operationMode', 'paymentEnvironment', 'midtransClientKey', 'midtransServerKey',
  'googleDriveEnabled', 'googleDriveRetentionDays', 'googleDriveFolder', 'googleDriveClientId', 'googleDriveAccountEmail',
  'cameraSettings', 'printerName', 'printerAutoPrint', 'printerPaperSize', 'printerCopies', 'printerColor',
]

function isTrustedRenderer(event) {
  const url = event.senderFrame?.url ?? ''
  return url.startsWith('file://') || url.startsWith('http://127.0.0.1:5173/')
}

function configPath() {
  return path.join(app.getPath('documents'), 'Capturs', 'config', 'store-config.json')
}

function frameManifestPath() {
  return path.join(path.dirname(configPath()), 'frame-manifest.json')
}

function frameAssetsDirectory() {
  return path.join(path.dirname(configPath()), 'frame-assets')
}

function driveRetentionLedgerPath() {
  return path.join(app.getPath('userData'), 'google-drive-retention.json')
}

function safeFrameId(frameId) {
  if (typeof frameId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(frameId)) throw new Error('ID frame tidak valid.')
  return frameId
}

function serializeFrameManifest(manifest) {
  const frames = Array.isArray(manifest?.frames) ? manifest.frames : []
  return JSON.stringify({
    activeFrameId: typeof manifest?.activeFrameId === 'string' ? manifest.activeFrameId : '',
    frames: frames.map((frame) => ({ ...frame, dataUrl: typeof frame.thumbnailDataUrl === 'string' ? frame.thumbnailDataUrl : '' })),
  })
}

async function readFrameManifest() {
  try {
    const parsed = JSON.parse(await fs.readFile(frameManifestPath(), 'utf8'))
    return { activeFrameId: typeof parsed.activeFrameId === 'string' ? parsed.activeFrameId : '', frames: Array.isArray(parsed.frames) ? parsed.frames : [] }
  } catch (error) {
    if (error.code === 'ENOENT') return { activeFrameId: '', frames: [] }
    throw error
  }
}

async function writeFrameManifest(manifest) {
  const destination = frameManifestPath()
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  await fs.writeFile(temporary, serializeFrameManifest(manifest), 'utf8')
  await fs.rename(temporary, destination)
}

function dataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return null
  try { return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64') } catch { return null }
}

function createFrameThumbnail(bytes) {
  try {
    const image = nativeImage.createFromBuffer(bytes)
    const size = image.getSize()
    const scale = Math.min(1, 240 / Math.max(size.width, size.height))
    const thumbnail = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }).toPNG()
    return `data:image/png;base64,${thumbnail.toString('base64')}`
  } catch {
    return ''
  }
}

async function writeFrameBytes(frameId, bytes) {
  const id = safeFrameId(frameId)
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error(`Gambar frame ${id} tidak valid.`)
  const directory = frameAssetsDirectory()
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, `${id}.png`)
  const temporary = `${target}.${process.pid}.tmp`
  await fs.writeFile(temporary, bytes)
  await fs.rename(temporary, target)
  return createHash('sha256').update(bytes).digest('hex')
}

async function persistFrameSettings(serialized, pendingAssets = []) {
  let manifest
  try { manifest = JSON.parse(typeof serialized === 'string' ? serialized : '{}') } catch { throw new Error('Manifest frame tidak valid.') }
  if (!manifest || !Array.isArray(manifest.frames) || manifest.frames.length > 500) throw new Error('Daftar frame tidak valid.')
  if (new Set(manifest.frames.map((frame) => frame?.id)).size !== manifest.frames.length) throw new Error('ID frame tidak boleh duplikat.')
  const uploads = new Map((Array.isArray(pendingAssets) ? pendingAssets : []).map((asset) => [safeFrameId(asset?.frameId), asset?.dataUrl]))
  const frames = await runWithConcurrency(manifest.frames, 3, async (source) => {
    const frame = { ...source }
    const id = safeFrameId(frame.id)
    const offeredDataUrl = typeof frame.dataUrl === 'string' ? frame.dataUrl : ''
    const dataUrl = uploads.get(id) ?? (offeredDataUrl && offeredDataUrl !== frame.thumbnailDataUrl ? offeredDataUrl : '')
    const bytes = dataUrlBytes(dataUrl)
    if (bytes?.length) {
      const nextHash = createHash('sha256').update(bytes).digest('hex')
      if (uploads.has(id) || nextHash !== frame.assetHash) frame.assetHash = await writeFrameBytes(id, bytes)
      else frame.assetHash = nextHash
      if (typeof frame.thumbnailDataUrl !== 'string' || !frame.thumbnailDataUrl) frame.thumbnailDataUrl = createFrameThumbnail(bytes)
    }
    frame.dataUrl = typeof frame.thumbnailDataUrl === 'string' ? frame.thumbnailDataUrl : ''
    return frame
  })
  const next = { activeFrameId: typeof manifest.activeFrameId === 'string' ? manifest.activeFrameId : '', frames }
  const previousSerialized = serializeFrameManifest(await readFrameManifest())
  const nextSerialized = serializeFrameManifest(next)
  await writeFrameManifest(next)
  const liveIds = new Set(frames.map((frame) => `${safeFrameId(frame.id)}.png`))
  const existingAssets = await fs.readdir(frameAssetsDirectory()).catch(() => [])
  await Promise.all(existingAssets.filter((name) => name.endsWith('.png') && !liveIds.has(name)).map((name) => fs.rm(path.join(frameAssetsDirectory(), name), { force: true })))
  return { manifest: next, changed: previousSerialized !== nextSerialized || uploads.size > 0 }
}

async function migrateLegacyFrameManifest(saved) {
  const existing = await fs.access(frameManifestPath()).then(() => true).catch(() => false)
  if (typeof saved?.public?.boothFrames !== 'string') return
  const existingManifest = existing ? await readFrameManifest() : null
  if (!existingManifest?.frames.length) await persistFrameSettings(saved.public.boothFrames)
  delete saved.public.boothFrames
  saved.frameCloudRevision = saved.frameCloudRevision ?? 0
  if (saved.public.syncUrl && (await readFrameManifest()).frames.length) saved.frameCloudPending = true
  await writeConfigFile(JSON.stringify(saved, null, 2))
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
    fs.mkdir(path.dirname(driveRetentionLedgerPath()), { recursive: true }),
  ])
}

async function writeConfigFile(contents) {
  const destination = configPath()
  const destinationDirectory = path.dirname(destination)
  await fs.mkdir(destinationDirectory, { recursive: true })
  const systemTempDirectory = app.getPath('temp')
  const temporaryDirectory = path.parse(systemTempDirectory).root.toLowerCase() === path.parse(destination).root.toLowerCase()
    ? systemTempDirectory
    : destinationDirectory
  const temporaryPath = path.join(temporaryDirectory, `capturs-config-${process.pid}-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporaryPath, contents, { flag: 'wx' })
    await fs.rename(temporaryPath, destination)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

function normalizeStoragePath(value) {
  return typeof value === 'string' && value.trim()
    ? path.resolve(value.trim())
    : defaultSessionStoragePath()
}

async function readStoredConfig() {
  try {
    const saved = JSON.parse(await fs.readFile(configPath(), 'utf8'))
    await migrateLegacyFrameManifest(saved)
    const driveConfigChanged = migrateLegacyDriveConfig(saved)
    const localEmailConfigChanged = migrateLegacyLocalEmailConfig(saved)
    const priceConfigChanged = migrateLegacyPriceConfig(saved)
    if (driveConfigChanged || localEmailConfigChanged || priceConfigChanged) await writeStoredConfig(saved)
    return saved
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  try {
    const legacyConfig = await fs.readFile(legacyConfigPath())
    const parsed = JSON.parse(legacyConfig.toString('utf8'))
    await migrateLegacyFrameManifest(parsed)
    migrateLegacyDriveConfig(parsed)
    migrateLegacyLocalEmailConfig(parsed)
    migrateLegacyPriceConfig(parsed)
    await writeStoredConfig(parsed)
    return parsed
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function migrateLegacyDriveConfig(saved) {
  if (!saved || typeof saved !== 'object') return false
  saved.public ??= {}
  saved.secrets ??= {}
  let changed = false
  const legacyPublicFields = {
    rcloneEnabled: 'googleDriveEnabled',
    rcloneRetentionDays: 'googleDriveRetentionDays',
    rcloneFolder: 'googleDriveFolder',
    rcloneClientId: 'googleDriveClientId',
  }
  for (const [legacy, current] of Object.entries(legacyPublicFields)) {
    if (saved.public[current] === undefined && saved.public[legacy] !== undefined) {
      saved.public[current] = saved.public[legacy]
      changed = true
    }
    if (saved.public[legacy] !== undefined) {
      delete saved.public[legacy]
      changed = true
    }
  }
  for (const legacy of ['rcloneExecutable', 'rcloneRemote', 'rcloneConfigPath']) {
    if (saved.public[legacy] !== undefined) {
      delete saved.public[legacy]
      changed = true
    }
  }
  if (!saved.secrets.googleDriveClientSecret && saved.secrets.rcloneClientSecret) {
    saved.secrets.googleDriveClientSecret = saved.secrets.rcloneClientSecret
    changed = true
  }
  if (saved.secrets.rcloneClientSecret) {
    delete saved.secrets.rcloneClientSecret
    changed = true
  }
  if (saved.public.googleDriveAccountEmail === undefined) {
    saved.public.googleDriveAccountEmail = ''
    changed = true
  }
  return changed
}

function migrateLegacyLocalEmailConfig(saved) {
  if (!saved || typeof saved !== 'object') return false
  let changed = false
  for (const field of ['customerEmailEnabled', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpFromName', 'smtpFromAddress', 'smtpUser', 'smtpPassword']) {
    if (saved.public?.[field] !== undefined) {
      delete saved.public[field]
      changed = true
    }
  }
  for (const field of ['smtpUser', 'smtpPassword']) {
    if (saved.secrets?.[field] !== undefined) {
      delete saved.secrets[field]
      changed = true
    }
  }
  return changed
}

function migrateLegacyPriceConfig(saved) {
  if (!saved || typeof saved !== 'object') return false
  saved.public ??= {}
  let changed = false
  const legacyPrice = Number(saved.public.price)
  const validLegacyPrice = Number.isSafeInteger(legacyPrice) && legacyPrice > 0 ? String(legacyPrice) : ''
  const currentStripPrice = Number(saved.public.photoStripPrice)
  if (!/^\d{1,9}$/.test(String(saved.public.photoStripPrice ?? '')) || !Number.isSafeInteger(currentStripPrice) || currentStripPrice < 1) {
    saved.public.photoStripPrice = validLegacyPrice || '35000'
    changed = true
  }
  const currentSinglePrice = Number(saved.public.singlePhotoPrice)
  if (!/^\d{1,9}$/.test(String(saved.public.singlePhotoPrice ?? '')) || !Number.isSafeInteger(currentSinglePrice) || currentSinglePrice < 1) {
    saved.public.singlePhotoPrice = validLegacyPrice ? String(Math.round(Number(validLegacyPrice) * 0.7)) : '24500'
    changed = true
  }
  if (saved.public.price !== undefined) {
    delete saved.public.price
    changed = true
  }
  return changed
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

async function updateLocalSessionInfo(sessionId, update, sessionDirectory) {
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId)) throw new Error('ID sesi untuk status Drive tidak valid.')
  const directory = sessionDirectory || path.join(await sessionStoragePath(), sessionId)
  if (path.basename(directory) !== sessionId) throw new Error('Folder sesi untuk status Drive tidak valid.')
  const target = path.join(directory, 'info.json')
  const info = JSON.parse(await fs.readFile(target, 'utf8'))
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify({ ...info, ...update }, null, 2), 'utf8')
    await fs.rename(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function readGoogleDriveAccounts(saved) {
  const encrypted = saved?.secrets?.googleDriveAccounts
  if (!encrypted) return []
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error('Penyimpanan aman sistem operasi tidak tersedia untuk Google Drive.')
  }
  let accounts
  try {
    accounts = JSON.parse(await decryptStoredString(Buffer.from(encrypted, 'base64')))
  } catch {
    throw new Error('Data akun Google Drive tersimpan rusak; hubungkan ulang akun dari Admin.')
  }
  if (!Array.isArray(accounts)) throw new Error('Data akun Google Drive tersimpan tidak valid.')
  return accounts.filter((account) => typeof account?.email === 'string'
    && typeof account?.clientId === 'string'
    && typeof account?.clientSecret === 'string'
    && typeof account?.refreshToken === 'string')
}

async function writeGoogleDriveAccounts(saved, accounts) {
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error('Penyimpanan aman sistem operasi tidak tersedia untuk menyimpan login Google Drive.')
  }
  saved.secrets ??= {}
  saved.secrets.googleDriveAccounts = (await safeStorage.encryptStringAsync(JSON.stringify(accounts))).toString('base64')
}

async function googleDriveAccountFor(saved, email) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const account = (await readGoogleDriveAccounts(saved)).find((candidate) => candidate.email === normalizedEmail)
  if (!account) throw new Error(`Akun Google Drive ${normalizedEmail || ''} belum tersimpan di booth ini.`)
  return account
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
  const email = typeof customer?.email === 'string' ? customer.email.trim() : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email pelanggan tidak valid.')
  return { email }
}

function isManagedDriveSessionId(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:-\d{2,})?$/.test(value)
}

function retentionDaysFromValue(value, fallback = defaultDriveRetentionDays) {
  const days = Number(value)
  return Number.isSafeInteger(days) && days >= 1 && days <= maxDriveRetentionDays ? days : fallback
}

function isValidGoogleDriveFolderPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || value.includes(':')) return false
  const segments = value.trim().replace(/\\/g, '/').split('/')
  return segments.every((segment) => segment.trim() && segment !== '.' && segment !== '..' && segment.trim().length <= 100)
}

function validateDriveRetentionEntry(entry) {
  const normalized = {
    id: typeof entry?.id === 'string' ? entry.id : '',
    sessionId: typeof entry?.sessionId === 'string' ? entry.sessionId : '',
    folderId: typeof entry?.folderId === 'string' ? entry.folderId : '',
    accountEmail: typeof entry?.accountEmail === 'string' ? entry.accountEmail.trim().toLowerCase() : '',
    uploadedAt: typeof entry?.uploadedAt === 'string' ? entry.uploadedAt : '',
    retentionDays: retentionDaysFromValue(entry?.retentionDays),
  }
  const uploadedAt = Date.parse(normalized.uploadedAt)
  if (!normalized.id || normalized.id.length > 100 || !isManagedDriveSessionId(normalized.sessionId)
    || !/^[a-zA-Z0-9_-]{5,200}$/.test(normalized.folderId)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.accountEmail)
    || !Number.isFinite(uploadedAt)) {
    throw new Error('Ledger retensi Drive rusak; penghapusan otomatis dijeda untuk melindungi file.')
  }
  return normalized
}

async function readDriveRetentionLedger() {
  try {
    const parsed = JSON.parse(await fs.readFile(driveRetentionLedgerPath(), 'utf8'))
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > maxDriveRetentionEntries) {
      throw new Error('Format ledger retensi Drive tidak valid.')
    }
    return parsed.entries.map(validateDriveRetentionEntry)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw new Error('Ledger retensi Drive tidak bisa dibaca; penghapusan otomatis dijeda untuk melindungi file.')
  }
}

async function writeDriveRetentionLedger(entries) {
  if (entries.length > maxDriveRetentionEntries) throw new Error('Ledger retensi Drive mencapai batas aman.')
  const destination = driveRetentionLedgerPath()
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify({ version: 1, entries }), { flag: 'wx' })
    await fs.rename(temporary, destination)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function updateDriveRetentionLedger(update) {
  const operation = driveRetentionLedgerQueue.then(async () => {
    const current = await readDriveRetentionLedger()
    const next = update(current)
    await writeDriveRetentionLedger(next)
    return next
  })
  driveRetentionLedgerQueue = operation.catch(() => {})
  return operation
}

async function trackDriveSessionForRetention(folderId, accountEmail, sessionId, uploadedAt, retentionDays) {
  if (!isManagedDriveSessionId(sessionId)) throw new Error('ID sesi Drive tidak valid untuk retensi otomatis.')
  const entry = validateDriveRetentionEntry({ id: randomUUID(), sessionId, folderId, accountEmail, uploadedAt, retentionDays })
  const next = await updateDriveRetentionLedger((current) => {
    if (current.length >= maxDriveRetentionEntries) throw new Error('Batas pencatatan retensi Drive tercapai; upload baru dijeda agar tidak kehilangan jadwal penghapusan.')
    const existing = current.find((item) => item.folderId === entry.folderId)
    return existing
      ? current.map((item) => item.id === existing.id ? { ...entry, id: existing.id } : item)
      : [...current, entry]
  })
  return next.find((item) => item.folderId === entry.folderId)
}

async function markDriveSessionUploaded(id, uploadedAt) {
  const timestamp = new Date(uploadedAt).toISOString()
  await updateDriveRetentionLedger((current) => current.map((item) => item.id === id ? { ...item, uploadedAt: timestamp } : item))
}

async function removeDriveRetentionEntry(id) {
  await updateDriveRetentionLedger((current) => current.filter((item) => item.id !== id))
}

async function runDriveRetentionCleanup() {
  if (driveRetentionCleanupPromise) return driveRetentionCleanupPromise
  const cleanup = (async () => {
    const saved = await readStoredConfig()
    if (!saved) return { removed: 0, pending: 0 }
    const entries = await readDriveRetentionLedger()
    const expired = entries
      .filter((entry) => Date.parse(entry.uploadedAt) + entry.retentionDays * driveRetentionDayMs <= Date.now())
      .sort((left, right) => Date.parse(left.uploadedAt) - Date.parse(right.uploadedAt))
      .slice(0, 12)
    let removed = 0
    await runWithConcurrency(expired, 2, async (entry) => {
      try {
        const account = await googleDriveAccountFor(saved, entry.accountEmail)
        try {
          await deleteSessionFolder(account, entry.folderId)
        } catch (error) {
          if (error?.code !== 404 && error?.response?.status !== 404) throw error
        }
        await removeDriveRetentionEntry(entry.id)
        removed += 1
      } catch {
        console.warn('[drive-retention] Penghapusan sesi Google Drive tertunda; akan dicoba lagi saat booth online.')
      }
    })
    if (removed) console.info(`[drive-retention] ${removed} folder sesi Google Drive kedaluwarsa dihapus.`)
    return { removed, pending: Math.max(0, entries.length - removed) }
  })()
  driveRetentionCleanupPromise = cleanup
  try {
    return await cleanup
  } finally {
    if (driveRetentionCleanupPromise === cleanup) driveRetentionCleanupPromise = null
  }
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
    if (!/^(Hasil\.png|Boomerang\.gif|Foto \d{2}\.png|Live Photos\.mp4)$/.test(name) || seen.has(name)) {
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
    if (name === 'Live Photos.mp4' && (
      file.bytes[4] !== 0x66 || file.bytes[5] !== 0x74 || file.bytes[6] !== 0x79 || file.bytes[7] !== 0x70
    )) throw new Error('Format video Live Photos tidak valid.')
    return { name, bytes: Buffer.from(file.bytes) }
  })

  if (totalBytes > 256 * 1024 * 1024 || !seen.has('Hasil.png') || !seen.has('Boomerang.gif') || ![...seen].some((name) => name.startsWith('Foto '))) {
    throw new Error('File hasil sesi belum lengkap.')
  }
  return normalized
}

function validateSessionMetadata(metadata) {
  const customer = validateCustomer({ email: metadata?.customerEmail })
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
  const sessionStartedAt = typeof metadata.sessionStartedAt === 'string' ? metadata.sessionStartedAt : ''
  if (sessionStartedAt && !Number.isFinite(Date.parse(sessionStartedAt))) throw new Error('Waktu mulai sesi tidak valid.')
  const sessionOutcome = metadata.sessionOutcome ?? 'complete'
  if (!['complete', 'partial'].includes(sessionOutcome)) throw new Error('Status penyelesaian sesi tidak valid.')
  return { customerEmail: customer.email, operationMode, paymentStatus, paymentOrderId, experience, sessionStartedAt, sessionOutcome }
}

function sessionPrice(savedConfig, experience) {
  const stripPrice = Number(savedConfig?.public?.photoStripPrice) || 35000
  return experience === 'single'
    ? Number(savedConfig?.public?.singlePhotoPrice) || 24500
    : stripPrice
}

async function notifyAbandonedSession(event, payload) {
  if (!isTrustedRenderer(event)) throw new Error('Akses pemberitahuan sesi ditolak.')
  const metadata = validateSessionMetadata({ ...payload, sessionOutcome: 'complete' })
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
  const startedAt = Date.parse(metadata.sessionStartedAt)
  if (!/^[a-zA-Z0-9_-]{5,100}$/.test(sessionId) || !Number.isFinite(startedAt) || startedAt > Date.now() + 60_000) {
    throw new Error('Identitas atau waktu mulai sesi tidak valid.')
  }
  if (!['paid', 'event'].includes(metadata.paymentStatus)) throw new Error('Email timeout hanya dikirim untuk sesi berbayar atau event.')
  const saved = await readStoredConfig()
  if (metadata.operationMode !== (saved?.public?.operationMode ?? 'dev')) throw new Error('Mode booth berubah. Mulai sesi baru untuk melanjutkan.')
  const paymentRecord = metadata.paymentStatus === 'paid' ? verifiedPaymentOrders.get(metadata.paymentOrderId) : null
  if (metadata.paymentStatus === 'paid' && !paymentRecord?.verified) throw new Error('Pembayaran sesi belum terverifikasi.')
  if (paymentRecord && !paymentRecord.syncQueued) {
    await enqueueSyncPayment({
      paymentOrderId: metadata.paymentOrderId,
      paidAt: paymentRecord.paidAt,
      amount: paymentRecord.amount,
      experience: paymentRecord.experience,
      operationMode: paymentRecord.operationMode,
      paymentEnvironment: paymentRecord.paymentEnvironment,
    })
    paymentRecord.syncQueued = true
  }
  await enqueueSyncSession({
    sessionId,
    createdAt: new Date(startedAt).toISOString(),
    customerEmail: metadata.customerEmail,
    paidAt: paymentRecord?.paidAt ?? new Date(startedAt).toISOString(),
    operationMode: metadata.operationMode,
    paymentStatus: metadata.paymentStatus,
    paymentOrderId: metadata.paymentOrderId,
    experience: metadata.experience,
    amount: metadata.paymentStatus === 'paid' ? paymentRecord.amount : 0,
    driveUploaded: false,
    driveLink: '',
    driveExpiresAt: '',
    sessionOutcome: 'abandoned',
    shotCount: 0,
  })
  if (metadata.paymentStatus === 'paid') verifiedPaymentOrders.delete(metadata.paymentOrderId)
  try {
    const sync = await runCloudSync()
    const pending = await readOutbox()
    const stillQueued = pending.some((entry) => outboxEventId(entry) === `session:${sessionId}`)
    return { queued: true, synced: !stillQueued, error: stillQueued ? sync?.message ?? 'Email menunggu koneksi WebAdmin.' : undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email timeout menunggu koneksi WebAdmin.'
    console.warn('[session-timeout-email]', message)
    return { queued: true, synced: false, error: message }
  }
}

function sendDriveUploadStatus(update) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('session:drive-upload-status', update)
  }
}

async function updateQueuedSessionDriveStatus(sessionId, update, sessionDirectory) {
  const directory = sessionDirectory || path.join(await sessionStoragePath(), sessionId)
  if (path.basename(directory) !== sessionId) throw new Error('Folder sesi untuk status Drive tidak valid.')
  const info = JSON.parse(await fs.readFile(path.join(directory, 'info.json'), 'utf8'))
  const amount = Number.isSafeInteger(info.amount) && info.amount >= 0
    ? info.amount
    : info.paymentStatus === 'paid' ? sessionPrice(await readStoredConfig(), info.experience) : 0
  const sessionEvent = {
    sessionId,
    createdAt: info.createdAt,
    customerEmail: info.customerEmail || info.email || '',
    paidAt: info.paidAt ?? '',
    operationMode: info.operationMode,
    paymentStatus: info.paymentStatus,
    paymentOrderId: info.paymentOrderId,
    experience: info.experience,
    sessionOutcome: info.sessionOutcome ?? 'complete',
    shotCount: Number.isInteger(info.shotCount) ? info.shotCount : 0,
    amount,
    driveUploaded: update.driveUploaded === true,
    driveLink: info.driveLink ?? '',
    driveExpiresAt: update.driveExpiresAt ?? info.driveExpiresAt ?? '',
    driveError: update.driveError ?? '',
    kind: 'session',
    eventId: `session:${sessionId}`,
  }
  const mergeSessionEvent = (current) => {
    const existingIndex = current.findIndex((entry) => outboxEventId(entry) === sessionEvent.eventId)
    if (existingIndex < 0) return [...current, sessionEvent]
    return current.map((entry, index) => index === existingIndex ? { ...entry, ...sessionEvent } : entry)
  }
  await mutateOutbox(mergeSessionEvent)
  setTimeout(() => {
    void (async () => {
      if (cloudSyncPromise) await cloudSyncPromise.catch(() => {})
      await mutateOutbox(mergeSessionEvent)
      await runCloudSync()
      const stillQueued = (await readOutbox()).some((entry) => outboxEventId(entry) === sessionEvent.eventId)
      if (!stillQueued) {
        await mutateOutbox(mergeSessionEvent)
        await runCloudSync()
      }
    })().catch((error) => {
      console.warn('[drive-sync] Status upload tetap tersimpan di antrean cloud.', error)
    })
  }, 500)
}

async function uploadDriveSessionInBackground({ account, folderId, files, retentionEntry, retentionDays, sessionId, sessionDirectory, driveLink }) {
  try {
    await uploadSessionFiles(account, folderId, files)
    const uploadedAt = new Date().toISOString()
    const driveExpiresAt = new Date(Date.parse(uploadedAt) + retentionDays * driveRetentionDayMs).toISOString()
    try {
      await markDriveSessionUploaded(retentionEntry.id, uploadedAt)
    } catch {
      console.warn('[drive-retention] Waktu upload tidak bisa diperbarui; jadwal awal tetap disimpan.')
    }
    await updateLocalSessionInfo(sessionId, { driveUploaded: true, driveStatus: 'uploaded', driveExpiresAt }, sessionDirectory).catch((error) => {
      console.warn('[drive-sync] Status upload tidak bisa diperbarui pada info sesi.', error)
    })
    await updateQueuedSessionDriveStatus(sessionId, { driveUploaded: true, driveExpiresAt }, sessionDirectory).catch((error) => {
      console.warn('[drive-sync] Upload selesai, tetapi statusnya belum masuk antrean cloud.', error)
    })
    sendDriveUploadStatus({ sessionId, status: 'uploaded', driveExpiresAt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload foto ke Google Drive gagal.'
    await updateLocalSessionInfo(sessionId, { driveUploaded: false, driveStatus: 'error', driveError: message }, sessionDirectory).catch((writeError) => {
      console.warn('[drive-sync] Status sesi gagal diperbarui.', writeError)
    })
    await updateQueuedSessionDriveStatus(sessionId, { driveUploaded: false, driveError: message }, sessionDirectory).catch((queueError) => {
      console.warn('[drive-sync] Status kegagalan upload tidak bisa diperbarui pada antrean cloud.', queueError)
    })
    sendDriveUploadStatus({ sessionId, status: 'error', error: message })
  }
}

const printerPaperSizes = {
  photo4x6: { width: 101600, height: 152400 },
  photo4x8: { width: 101600, height: 203200 },
  a4: { width: 210000, height: 297000 },
  a3: 'A3',
}

function normalizedPrinterSettings(input = {}) {
  const printerName = typeof input.printerName === 'string' ? input.printerName.trim() : ''
  const paperSize = ['photo4x6', 'photo4x8', 'a4', 'a3', 'printer'].includes(input.printerPaperSize)
    ? input.printerPaperSize
    : 'photo4x6'
  const copiesValue = Number(input.printerCopies)
  const copies = Number.isInteger(copiesValue) ? Math.max(1, Math.min(5, copiesValue)) : 1
  return {
    printerName: printerName.slice(0, 240),
    paperSize,
    copies,
    color: input.printerColor !== false && input.printerColor !== 'grayscale',
  }
}

async function runPrintJob(ownerWindow, settings, { imagePath = '', test = false } = {}) {
  if (!ownerWindow || ownerWindow.isDestroyed()) throw new Error('Jendela booth tidak tersedia untuk mencetak.')
  const printers = await ownerWindow.webContents.getPrintersAsync()
  if (settings.printerName && !printers.some((printer) => printer.name === settings.printerName)) {
    throw new Error('Printer yang dipilih tidak terdeteksi. Sambungkan printer atau pilih printer lain.')
  }

  const printWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 1000,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  try {
    const query = test
      ? { test: '1' }
      : { image: pathToFileURL(imagePath).href }
    await printWindow.loadFile(path.join(__dirname, 'print.html'), { query })
    await printWindow.webContents.executeJavaScript('window.preparePrint()')

    const options = {
      silent: true,
      printBackground: true,
      color: settings.color,
      copies: test ? 1 : settings.copies,
      margins: { marginType: 'none' },
      usePrinterDefaultPageSize: settings.paperSize === 'printer',
    }
    if (settings.printerName) options.deviceName = settings.printerName
    if (settings.paperSize !== 'printer') options.pageSize = printerPaperSizes[settings.paperSize]

    await new Promise((resolve, reject) => {
      printWindow.webContents.print(options, (success, failureReason) => {
        if (success) resolve()
        else reject(new Error(failureReason || 'Printer gagal mencetak hasil.'))
      })
    })
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close()
  }
}

async function listPrinters(event) {
  if (!isTrustedRenderer(event)) throw new Error('Akses daftar printer ditolak.')
  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  if (!ownerWindow) throw new Error('Jendela booth tidak tersedia.')
  const printers = await ownerWindow.webContents.getPrintersAsync()
  return printers.map(({ name, displayName, description, status, isDefault }) => ({ name, displayName, description, status, isDefault }))
}

async function testPrinter(event, input) {
  if (!isTrustedRenderer(event)) throw new Error('Akses tes printer ditolak.')
  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  const settings = normalizedPrinterSettings(input)
  try {
    await runPrintJob(ownerWindow, settings, { test: true })
    return { printed: true }
  } catch (error) {
    return { printed: false, error: error instanceof Error ? error.message : 'Tes printer gagal.' }
  }
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
  let paymentRecord = null
  if (metadata.paymentStatus === 'paid') {
    paymentRecord = verifiedPaymentOrders.get(metadata.paymentOrderId)
    if (!paymentRecord?.verified) throw new Error('Pembayaran sesi belum terverifikasi.')
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
  const createdAt = metadata.sessionStartedAt || new Date().toISOString()
  const sessionMetadata = {
    ...metadata,
    sessionId: directoryName,
    createdAt,
    shotCount: normalizedFiles.filter(({ name }) => /^Foto \d+\.png$/.test(name)).length,
    paidAt: paymentRecord?.paidAt ?? '',
    amount: metadata.paymentStatus === 'paid' ? paymentRecord?.amount ?? 0 : 0,
    driveUploaded: false,
    driveLink: '',
    driveExpiresAt: '',
    driveStatus: 'disabled',
  }
  await fs.mkdir(pendingPath)
  try {
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

  let driveUploaded = false
  let driveLink = ''
  let driveExpiresAt = ''
  let driveError = ''
  let driveStatus = 'disabled'
  let driveBackgroundJob = null
  if (savedConfig?.public?.googleDriveEnabled === 'true') {
    try {
      const retentionDays = retentionDaysFromValue(savedConfig.public.googleDriveRetentionDays)
      const accountEmail = savedConfig.public.googleDriveAccountEmail
      const account = await googleDriveAccountFor(savedConfig, accountEmail)
      const folderId = await createSessionFolder(account, savedConfig.public.googleDriveFolder, directoryName)
      let retentionEntry
      try {
        retentionEntry = await trackDriveSessionForRetention(folderId, accountEmail, directoryName, new Date().toISOString(), retentionDays)
        driveLink = await shareSessionFolder(account, folderId)
      } catch (error) {
        if (retentionEntry) await removeDriveRetentionEntry(retentionEntry.id).catch(() => {})
        await deleteSessionFolder(account, folderId).catch(() => {})
        throw error
      }
      driveStatus = 'uploading'
      driveBackgroundJob = { account, folderId, retentionEntry, retentionDays, sessionId: directoryName, sessionDirectory: directoryPath, driveLink }
      await updateLocalSessionInfo(directoryName, { driveUploaded: false, driveLink, driveStatus: 'uploading' }, directoryPath).catch((error) => {
        console.warn('[drive-sync] Link Drive tidak bisa disimpan ke info sesi.', error)
      })
    } catch (error) {
      driveError = error instanceof Error ? error.message : 'Upload foto ke Google Drive gagal.'
      driveStatus = 'error'
    }
  }

  let syncQueued = false
  let syncQueueError = ''
  if (paymentRecord && !paymentRecord.syncQueued) {
    try {
      await enqueueSyncPayment({
        paymentOrderId: metadata.paymentOrderId,
        paidAt: paymentRecord.paidAt,
        amount: paymentRecord.amount,
        experience: paymentRecord.experience,
        operationMode: paymentRecord.operationMode,
        paymentEnvironment: paymentRecord.paymentEnvironment,
      })
      paymentRecord.syncQueued = true
    } catch (error) {
      syncQueueError = error instanceof Error ? error.message : 'Transaksi tersimpan, tetapi antrean cloud gagal dibuat.'
    }
  }
  try {
    await enqueueSyncSession({
      sessionId: directoryName,
      createdAt,
      customerEmail: metadata.customerEmail,
      paidAt: paymentRecord?.paidAt ?? '',
      operationMode: metadata.operationMode,
      paymentStatus: metadata.paymentStatus,
      paymentOrderId: metadata.paymentOrderId,
      experience: metadata.experience,
      sessionOutcome: metadata.sessionOutcome,
      shotCount: normalizedFiles.filter(({ name }) => /^Foto \d+\.png$/.test(name)).length,
      amount: metadata.paymentStatus === 'paid' ? paymentRecord.amount : 0,
      driveUploaded,
      driveLink,
      driveExpiresAt,
    })
    syncQueued = true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sesi tersimpan, tetapi antrean sinkronisasi gagal dibuat.'
    syncQueueError = [syncQueueError, message].filter(Boolean).join(' ')
  }

  if (driveBackgroundJob) {
    void uploadDriveSessionInBackground({ ...driveBackgroundJob, files: normalizedFiles })
  }

  let printed = false
  let printError = ''
  if (savedConfig?.public?.printerAutoPrint !== 'false') {
    try {
      await runPrintJob(BrowserWindow.fromWebContents(event.sender), normalizedPrinterSettings(savedConfig?.public), {
        imagePath: path.join(directoryPath, 'Hasil.png'),
      })
      printed = true
    } catch (error) {
      printError = error instanceof Error ? error.message : 'Foto tersimpan, tetapi printer gagal mencetak.'
    }
  }

  return { saved: true, directory: directoryPath, sessionId: directoryName, driveUploaded, driveLink, driveExpiresAt, driveError, driveStatus, syncQueued, syncQueueError, printed, printError }
}

async function loadConfig(event) {
  if (!isTrustedRenderer(event)) throw new Error('Akses konfigurasi ditolak.')
  try {
    await ensureCaptursDirectories()
    const saved = await readStoredConfig()
    if (!saved) return {
      storagePath: defaultSessionStoragePath(),
      boothFrames: serializeFrameManifest(await readFrameManifest()),
      syncToken: '',
      syncTokenConfigured: false,
      telegramBotToken: '',
      telegramBotTokenConfigured: false,
      telegramChatId: '',
      googleDriveEnabled: 'false',
      googleDriveRetentionDays: String(defaultDriveRetentionDays),
      googleDriveFolder: 'Capturs',
      googleDriveClientId: '',
      googleDriveAccountEmail: '',
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
    config.syncToken = ''
    config.syncTokenConfigured = Boolean(saved.secrets?.syncToken && encryptionAvailable)
    config.telegramBotToken = ''
    config.telegramBotTokenConfigured = Boolean(saved.secrets?.telegramBotToken && encryptionAvailable)
    config.telegramChatId = typeof config.telegramChatId === 'string' ? config.telegramChatId : ''
    config.googleDriveEnabled = config.googleDriveEnabled === 'true' ? 'true' : 'false'
    config.googleDriveRetentionDays = String(retentionDaysFromValue(config.googleDriveRetentionDays))
    config.googleDriveFolder = typeof config.googleDriveFolder === 'string' && config.googleDriveFolder.trim() ? config.googleDriveFolder : 'Capturs'
    config.googleDriveClientId = typeof config.googleDriveClientId === 'string' ? config.googleDriveClientId : ''
    config.googleDriveAccountEmail = typeof saved.public?.googleDriveAccountEmail === 'string' ? saved.public.googleDriveAccountEmail : ''
    config.storagePath = normalizeStoragePath(config.storagePath)
    config.photoStripPrice = typeof config.photoStripPrice === 'string' && /^\d{1,9}$/.test(config.photoStripPrice) ? config.photoStripPrice : '35000'
    config.singlePhotoPrice = typeof config.singlePhotoPrice === 'string' && /^\d{1,9}$/.test(config.singlePhotoPrice) ? config.singlePhotoPrice : '24500'
    config.sessionTimeoutMinutes = /^([1-9]|[1-5]\d|60)$/.test(String(config.sessionTimeoutMinutes ?? '')) ? String(config.sessionTimeoutMinutes) : '5'
    config.printerName = typeof config.printerName === 'string' ? config.printerName : ''
    config.printerAutoPrint = config.printerAutoPrint === 'false' ? 'false' : 'true'
    config.printerPaperSize = ['photo4x6', 'photo4x8', 'a4', 'a3', 'printer'].includes(config.printerPaperSize) ? config.printerPaperSize : 'photo4x6'
    config.printerCopies = String(Number.isInteger(Number(config.printerCopies)) && Number(config.printerCopies) >= 1 && Number(config.printerCopies) <= 5 ? Number(config.printerCopies) : 1)
    config.printerColor = config.printerColor === 'grayscale' ? 'grayscale' : 'color'
    config.boothFrames = serializeFrameManifest(await readFrameManifest())
    return config
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

async function readConfigRevision() {
  try {
    const [configStats, frameStats] = await Promise.all([
      fs.stat(configPath()).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error)),
      fs.stat(frameManifestPath()).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error)),
    ])
    return `${configStats ? `${configStats.mtimeMs}:${configStats.size}` : ''}|${frameStats ? `${frameStats.mtimeMs}:${frameStats.size}` : ''}`
  } catch (error) {
    throw error
  }
}

async function getConfigRevision(event) {
  if (!isTrustedRenderer(event)) throw new Error('Akses konfigurasi ditolak.')
  return readConfigRevision()
}

const cloudConfigFields = [
  'storeName', 'photoStripPrice', 'singlePhotoPrice', 'sessionTimeoutMinutes', 'operationMode', 'paymentEnvironment', 'midtransClientKey',
  'googleDriveEnabled', 'googleDriveRetentionDays', 'googleDriveFolder', 'cameraSettings',
]
const maxCloudSyncBodyBytes = 4_200_000
const maxCloudConfigFieldBytes = 4_000_000
let cloudSyncPromise = null
let cloudUpdateCheckPromise = null
let cloudConfigApplyPromise = null
let cloudFrameApplyPromise = null
let cloudConfigApplyAllowed = false
let cloudFrameApplyAllowed = false
let boothSessionActive = false
let maintenanceSyncInProgress = false
let maintenanceSyncCheckpoint = null
let restartScheduled = false
let outboxWriteQueue = Promise.resolve()
let driveRetentionLedgerQueue = Promise.resolve()
let driveRetentionCleanupPromise = null

function cloudConfigFromPublic(publicConfig = {}) {
  return Object.fromEntries(cloudConfigFields.map((field) => [field, String(publicConfig[field] ?? '')]))
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function frameManifestFingerprint(manifest = {}) {
  const frames = Array.isArray(manifest.frames) ? manifest.frames : []
  const comparable = {
    activeFrameId: typeof manifest.activeFrameId === 'string' ? manifest.activeFrameId : '',
    frames: frames.map((frame) => ({
      id: frame.id,
      name: frame.name,
      width: frame.width,
      height: frame.height,
      appliesTo: frame.appliesTo,
      slots: frame.slots,
      assetHash: frame.assetHash,
      thumbnailDataUrl: frame.thumbnailDataUrl ?? frame.dataUrl ?? '',
    })),
  }
  return createHash('sha256').update(stableJson(comparable)).digest('hex')
}

async function cloudBaseUrl(saved) {
  const baseUrl = typeof saved?.public?.syncUrl === 'string' ? saved.public.syncUrl.trim().replace(/\/+$/, '') : ''
  if (!baseUrl) throw new Error('URL web admin belum diatur.')
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('URL backend sinkronisasi tidak valid.')
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error('URL sinkronisasi harus menggunakan HTTPS.')
  }
  return baseUrl
}

async function ensureDeviceIdentity(saved) {
  if (saved.deviceId && saved.devicePublicKey && saved.secrets?.devicePrivateKey) return
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Penyimpanan aman sistem operasi tidak tersedia untuk membuat identitas booth.')
  const pair = generateKeyPairSync('ed25519')
  saved.deviceId = saved.deviceId || randomUUID()
  saved.devicePublicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  saved.secrets = saved.secrets ?? {}
  saved.secrets.devicePrivateKey = (await safeStorage.encryptStringAsync(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toString('base64')
  await writeStoredConfig(saved)
}

async function rotateCloudDeviceIdentity(saved) {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Penyimpanan aman sistem operasi tidak tersedia untuk membuat identitas booth baru.')
  const pair = generateKeyPairSync('ed25519')
  saved.deviceId = randomUUID()
  saved.devicePublicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  saved.secrets = saved.secrets ?? {}
  saved.secrets.devicePrivateKey = (await safeStorage.encryptStringAsync(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toString('base64')
  saved.deviceApproved = false
  saved.cloudRevision = 0
  saved.frameCloudRevision = 0
  saved.cloudPending = true
  saved.frameCloudPending = (await readFrameManifest()).frames.length > 0
  await writeStoredConfig(saved)
}

async function cloudRequest(saved, pathName, options = {}) {
  const baseUrl = await cloudBaseUrl(saved)
  await ensureDeviceIdentity(saved)
  const privateKey = await decryptStoredString(Buffer.from(saved.secrets.devicePrivateKey, 'base64'))
  const method = (options.method ?? 'GET').toUpperCase()
  if (pathName === '/api/device/sync' && method === 'PUT' && typeof options.body === 'string') {
    const bodyBytes = Buffer.byteLength(options.body, 'utf8')
    if (bodyBytes > maxCloudSyncBodyBytes) {
      throw new Error(`Konfigurasi booth berukuran ${(bodyBytes / 1_000_000).toFixed(2)} MB; batas sinkronisasi 4,2 MB. Kecilkan atau kompres PNG frame.`)
    }
  }
  const target = new URL(`${baseUrl}${pathName}`)
  const bodyValue = typeof options.body === 'string' && options.body ? JSON.parse(options.body) : options.body
  const bodyHash = createHash('sha256').update(options.body === undefined ? '' : stableJson(bodyValue)).digest('hex')
  const timestamp = String(Date.now())
  const nonce = randomUUID()
  const signedMessage = `${method}\n${target.pathname}${target.search}\n${timestamp}\n${nonce}\n${bodyHash}`
  const signature = sign(null, Buffer.from(signedMessage), privateKey).toString('base64url')
  const { responseType, timeoutMs, ...fetchOptions } = options
  const response = await fetch(target, {
    ...fetchOptions,
    headers: {
      Accept: responseType === 'bytes' ? 'image/png' : 'application/json',
      'Content-Type': 'application/json',
      'X-Booth-Id': saved.deviceId,
      'X-Booth-Time': timestamp,
      'X-Booth-Nonce': nonce,
      'X-Booth-Signature': signature,
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(timeoutMs ?? (responseType === 'bytes' ? 120000 : 30000)),
  })
  if (responseType === 'bytes' && response.ok) return Buffer.from(await response.arrayBuffer())
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Server sinkronisasi merespons HTTP ${response.status}.`)
  return result
}

const telegramBot = createTelegramBot({
  async getSettings() {
    const saved = await readStoredConfig()
    let token = ''
    if (saved?.secrets?.telegramBotToken && await safeStorage.isAsyncEncryptionAvailable()) {
      token = await decryptStoredString(Buffer.from(saved.secrets.telegramBotToken, 'base64'))
    }
    return {
      token,
      chatId: String(saved?.public?.telegramChatId ?? '').trim(),
      syncUrl: String(saved?.public?.syncUrl ?? '').trim(),
      deviceApproved: saved?.deviceApproved === true,
    }
  },
  async claimEvent() {
    const saved = await readStoredConfig()
    if (!saved?.public?.syncUrl?.trim() || saved.deviceApproved !== true) return null
    const result = await cloudRequest(saved, '/api/device/telegram-events', {
      method: 'POST',
      body: JSON.stringify({ action: 'claim' }),
      timeoutMs: 15_000,
    })
    return result.event ?? null
  },
  async settleEvent(eventId, outcome) {
    const saved = await readStoredConfig()
    if (!saved?.public?.syncUrl?.trim() || saved.deviceApproved !== true) return
    await cloudRequest(saved, '/api/device/telegram-events', {
      method: 'POST',
      body: JSON.stringify({ eventId, ...outcome }),
      timeoutMs: 15_000,
    })
  },
  async onChatId(chatId) {
    const saved = await readStoredConfig()
    if (!saved) return
    saved.public.telegramChatId = chatId
    await writeStoredConfig(saved)
    if (saved.public.syncUrl?.trim() && saved.secrets?.telegramBotToken) {
      try {
        await syncTelegramSettings(saved)
        saved.telegramChatIdSynced = chatId
        await writeStoredConfig(saved)
      } catch (error) {
        console.warn('[telegram chat sync]', error instanceof Error ? error.message : 'Chat ID belum tersinkron.')
      }
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('telegram:chat-id', chatId)
    }
  },
})

async function ensureCloudDevice(saved) {
  const baseUrl = await cloudBaseUrl(saved)
  await ensureDeviceIdentity(saved)
  if (saved.secrets?.syncToken) {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Penyimpanan aman sistem operasi tidak tersedia untuk memigrasikan koneksi booth.')
    const legacyToken = await decryptStoredString(Buffer.from(saved.secrets.syncToken, 'base64'))
    const response = await fetch(`${baseUrl}/api/device/identity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${legacyToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: saved.devicePublicKey }),
      signal: AbortSignal.timeout(15000),
    })
    const result = await response.json().catch(() => ({}))
    if (response.ok) {
      saved.deviceId = result.deviceId
      delete saved.secrets.syncToken
      saved.deviceApproved = true
      saved.cloudRevision = 0
      saved.cloudPending = true
      await writeStoredConfig(saved)
    } else if ([401, 403, 404].includes(response.status)) {
      delete saved.secrets.syncToken
      saved.deviceId = randomUUID()
      saved.deviceApproved = false
      saved.cloudRevision = 0
      saved.cloudPending = true
      await writeStoredConfig(saved)
    } else throw new Error(typeof result.error === 'string' ? result.error : `Migrasi identitas booth gagal (${response.status}).`)
  }
  if (saved.deviceApproved) return
  let response
  try {
    response = await cloudRequest(saved, '/api/device/register', {
      method: 'POST',
      body: JSON.stringify({ deviceId: saved.deviceId, publicKey: saved.devicePublicKey, name: os.hostname() }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (!message.includes('Identitas booth ini sudah dihapus')
      && !message.includes('ID booth sudah terdaftar dengan identitas berbeda')) throw error
    await rotateCloudDeviceIdentity(saved)
    return ensureCloudDevice(saved)
  }
  if (response.status === 'revoked') throw new Error('Akses booth ini sudah dicabut di Web Admin.')
  if (response.status !== 'approved') throw new Error('Booth terdeteksi di Web Admin dan menunggu persetujuan admin.')
  saved.deviceApproved = true
  saved.cloudPending = true
  await writeStoredConfig(saved)
}

function validatedCloudConfig(input, current = {}) {
  const next = { ...current, googleDriveRetentionDays: String(retentionDaysFromValue(current.googleDriveRetentionDays)) }
  if (typeof input?.storeName === 'string' && input.storeName.trim().length <= 100) next.storeName = input.storeName.trim()
  if (typeof input?.photoStripPrice === 'string' && /^\d{1,9}$/.test(input.photoStripPrice) && Number(input.photoStripPrice) > 0) next.photoStripPrice = input.photoStripPrice
  if (typeof input?.singlePhotoPrice === 'string' && /^\d{1,9}$/.test(input.singlePhotoPrice) && Number(input.singlePhotoPrice) > 0) next.singlePhotoPrice = input.singlePhotoPrice
  if (typeof input?.sessionTimeoutMinutes === 'string' && /^([1-9]|[1-5]\d|60)$/.test(input.sessionTimeoutMinutes)) next.sessionTimeoutMinutes = input.sessionTimeoutMinutes
  if (input?.photoStripPrice === undefined && typeof input?.price === 'string' && /^\d{1,9}$/.test(input.price) && Number(input.price) > 0) {
    next.photoStripPrice = input.price
    if (current.singlePhotoPrice === undefined) next.singlePhotoPrice = '24500'
  }
  if (['dev', 'booth', 'event'].includes(input?.operationMode)) next.operationMode = input.operationMode
  if (['sandbox', 'production'].includes(input?.paymentEnvironment)) next.paymentEnvironment = input.paymentEnvironment
  if (typeof input?.midtransClientKey === 'string' && input.midtransClientKey.length <= 200) next.midtransClientKey = input.midtransClientKey.trim()
  if (input?.googleDriveEnabled === 'true' || input?.googleDriveEnabled === 'false') next.googleDriveEnabled = input.googleDriveEnabled
  if (isValidGoogleDriveFolderPath(input?.googleDriveFolder)) next.googleDriveFolder = input.googleDriveFolder.trim()
  if (typeof input?.googleDriveRetentionDays === 'string' && /^\d{1,4}$/.test(input.googleDriveRetentionDays)) {
    const days = Number(input.googleDriveRetentionDays)
    if (days >= 1 && days <= maxDriveRetentionDays) next.googleDriveRetentionDays = String(days)
  }
  for (const field of ['cameraSettings']) {
    if (typeof input?.[field] === 'string' && Buffer.byteLength(input[field], 'utf8') <= maxCloudConfigFieldBytes) {
      try { JSON.parse(input[field]); next[field] = input[field] } catch { /* Keep the last valid local value. */ }
    }
  }
  if (typeof input?.storeId === 'string' && /^[a-zA-Z0-9_-]{3,80}$/.test(input.storeId)) next.storeId = input.storeId
  return next
}

async function writeStoredConfig(saved) {
  await writeConfigFile(JSON.stringify(saved, null, 2))
}

async function pushLocalCloudConfig(saved) {
  await ensureCloudDevice(saved)
  const response = await cloudRequest(saved, '/api/device/sync', {
    method: 'PUT',
    body: JSON.stringify({ config: cloudConfigFromPublic(saved.public), expectedRevision: Number.isSafeInteger(saved.cloudRevision) ? saved.cloudRevision : undefined }),
  })
  if (Number.isSafeInteger(response.revision)) {
    saved.cloudRevision = response.revision
    saved.cloudPending = false
    if (typeof response.storeId === 'string' && /^[a-zA-Z0-9_-]{3,80}$/.test(response.storeId)) saved.public.storeId = response.storeId
    await writeStoredConfig(saved)
  }
}

async function syncTelegramSettings(saved) {
  if (!saved?.public?.syncUrl?.trim()) throw new Error('Atur URL Web Admin dan simpan koneksi sebelum mengaktifkan Telegram.')
  const chatId = saved.secrets?.telegramBotToken ? String(saved.public?.telegramChatId ?? '').trim() : ''
  const response = await cloudRequest(saved, '/api/device/telegram', {
    method: 'PUT',
    body: JSON.stringify({ chatId }),
  })
  return { chatConfigured: response.chatConfigured === true }
}

async function pushLocalCloudFrames(saved, knownRemote = null) {
  await ensureCloudDevice(saved)
  const remote = knownRemote ?? await cloudRequest(saved, '/api/device/frames')
  const localManifest = await readFrameManifest()
  if (frameManifestFingerprint(localManifest) === frameManifestFingerprint(remote.manifest ?? { activeFrameId: '', frames: [] })) {
    saved.frameCloudRevision = Number.isSafeInteger(remote.revision) ? remote.revision : 0
    saved.frameCloudPending = false
    await writeStoredConfig(saved)
    return
  }
  const uploadedHashes = new Set(remote.manifest?.frames?.map((frame) => frame.assetHash) ?? [])
  const scheduledHashes = new Set(uploadedHashes)
  const framesToUpload = localManifest.frames.filter((frame) => {
    if (!frame.assetHash || scheduledHashes.has(frame.assetHash)) return false
    scheduledHashes.add(frame.assetHash)
    return true
  })
  await runWithConcurrency(framesToUpload, 2, async (frame) => {
    const id = safeFrameId(frame.id)
    const bytes = await fs.readFile(path.join(frameAssetsDirectory(), `${id}.png`)).catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`File PNG frame ${frame.name} tidak ditemukan pada perangkat.`)
      throw error
    })
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
    if (Buffer.byteLength(JSON.stringify({ dataUrl }), 'utf8') > 4_490_000) throw new Error(`PNG frame ${frame.name} melewati batas unggah 4,49 MB setelah encoding. Kecilkan PNG ini.`)
    await cloudRequest(saved, `/api/device/frame?frameId=${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify({ dataUrl }), timeoutMs: 120000,
    })
  })
  const response = await cloudRequest(saved, '/api/device/frames', {
    method: 'PUT',
    body: JSON.stringify({ manifest: localManifest, expectedRevision: Number.isSafeInteger(remote.revision) ? remote.revision : 0 }),
  })
  saved.frameCloudRevision = response.revision
  saved.frameCloudPending = false
  await writeStoredConfig(saved)
}

async function syncCloudFrames(saved, { preferRemote = false } = {}) {
  const localManifest = await readFrameManifest()
  let remote = await cloudRequest(saved, `/api/device/frames?revision=${encodeURIComponent(saved.frameCloudRevision ?? 0)}`)
  if (!saved.frameCloudPending && saved.frameCloudRevision === undefined && remote.revision === 0 && localManifest.frames.length) {
    saved.frameCloudPending = true
    await writeStoredConfig(saved)
  }
  if (saved.frameCloudPending && (!preferRemote || remote.revision === (saved.frameCloudRevision ?? 0))) {
    if (remote.unchanged || !remote.manifest) remote = await cloudRequest(saved, '/api/device/frames')
    await pushLocalCloudFrames(saved, remote)
    return false
  }
  if (remote.unchanged) return false
  if (Number.isSafeInteger(remote.revision) && remote.revision !== (saved.frameCloudRevision ?? 0)) {
    if (!cloudFrameApplyAllowed) return true
    const manifest = remote.manifest ?? { activeFrameId: '', frames: [] }
    const remoteHashes = new Map(manifest.frames.map((frame) => [frame.id, frame.assetHash]))
    const apply = (async () => {
      await Promise.all(localManifest.frames.filter((frame) => frame.assetHash !== remoteHashes.get(frame.id)).map((frame) =>
        fs.rm(path.join(frameAssetsDirectory(), `${safeFrameId(frame.id)}.png`), { force: true })))
      await writeFrameManifest(manifest)
      saved.frameCloudRevision = remote.revision
      saved.frameCloudPending = false
      await writeStoredConfig(saved)
    })()
    cloudFrameApplyPromise = apply
    try {
      await apply
    } finally {
      if (cloudFrameApplyPromise === apply) cloudFrameApplyPromise = null
    }
  }
  return false
}

async function downloadRemoteFrameAssets(saved) {
  const manifest = await readFrameManifest()
  const assets = []
  for (const frame of manifest.frames) {
    if (typeof frame.assetHash !== 'string' || !frame.assetHash) continue
    const id = safeFrameId(frame.id)
    const localPath = path.join(frameAssetsDirectory(), `${id}.png`)
    const localBytes = await fs.readFile(localPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (localBytes && createHash('sha256').update(localBytes).digest('hex') === frame.assetHash) continue
    assets.push({ id, assetHash: frame.assetHash })
  }
  await runWithConcurrency(assets, 2, async ({ id, assetHash }) => {
    const bytes = await cloudRequest(saved, `/api/device/frame?frameId=${encodeURIComponent(id)}&format=png`, {
      responseType: 'bytes',
      timeoutMs: 120_000,
    })
    if (!bytes?.length || createHash('sha256').update(bytes).digest('hex') !== assetHash) {
      throw new Error(`PNG frame ${id} tidak cocok dengan manifest cloud.`)
    }
    await writeFrameBytes(id, bytes)
  })
  return assets.length
}

async function loadFrameAsset(event, frameId) {
  if (!isTrustedRenderer(event)) throw new Error('Akses gambar frame ditolak.')
  const id = safeFrameId(frameId)
  const localPath = path.join(frameAssetsDirectory(), `${id}.png`)
  const localBytes = await fs.readFile(localPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (localBytes) return `data:image/png;base64,${localBytes.toString('base64')}`
  const saved = await readStoredConfig()
  if (!saved?.public?.syncUrl) throw new Error('File PNG frame tidak ditemukan pada perangkat.')
  await ensureCloudDevice(saved)
  const bytes = await cloudRequest(saved, `/api/device/frame?frameId=${encodeURIComponent(id)}&format=png`, { responseType: 'bytes' })
  if (!bytes?.length) throw new Error('Gambar frame cloud tidak valid.')
  const manifest = await readFrameManifest()
  const frame = manifest.frames.find((item) => item.id === id)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (frame?.assetHash && frame.assetHash !== hash) throw new Error('Gambar frame cloud tidak cocok dengan manifest.')
  await writeFrameBytes(id, bytes)
  return `data:image/png;base64,${bytes.toString('base64')}`
}

async function outboxPath() {
  await ensureCaptursDirectories()
  return path.join(path.dirname(configPath()), 'sync-outbox.json')
}

async function readOutbox() {
  try {
    const value = JSON.parse(await fs.readFile(await outboxPath(), 'utf8'))
    return Array.isArray(value) ? value : []
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function mutateOutbox(update) {
  const task = outboxWriteQueue.then(async () => {
    const current = await readOutbox()
    const next = update(current)
    const target = await outboxPath()
    const temporary = `${target}.${process.pid}.tmp`
    await fs.writeFile(temporary, JSON.stringify(next), 'utf8')
    await fs.rename(temporary, target)
    return next
  })
  outboxWriteQueue = task.catch(() => {})
  return task
}

async function enqueueSyncSession(session) {
  return enqueueSyncEvent({ ...session, kind: 'session', eventId: `session:${session.sessionId}` })
}

function outboxEventId(entry) {
  return typeof entry.eventId === 'string' ? entry.eventId : typeof entry.sessionId === 'string' ? `session:${entry.sessionId}` : ''
}

async function enqueueSyncEvent(event) {
  return mutateOutbox((current) => {
    if (current.some((entry) => outboxEventId(entry) === event.eventId)) return current
    return [...current, event]
  })
}

async function enqueueSyncPayment(payment) {
  return enqueueSyncEvent({ ...payment, kind: 'payment', eventId: `payment:${payment.paymentOrderId}` })
}

async function enqueueCurrentAppRun(saved) {
  if (appRunQueued || !saved?.public?.syncUrl?.trim()) return
  await enqueueSyncEvent({ ...appRun, kind: 'app-run', eventId: `run:${appRun.runId}` })
  appRunQueued = true
}

async function hydrateLegacySession(entry) {
  if (entry.kind && entry.kind !== 'session' || typeof entry.sessionId !== 'string' || !/^[a-zA-Z0-9_-]{5,100}$/.test(entry.sessionId)) return entry
  try {
    const infoPath = path.join(await sessionStoragePath(), entry.sessionId, 'info.json')
    const metadata = JSON.parse(await fs.readFile(infoPath, 'utf8'))
    return {
      ...entry,
      customerEmail: entry.customerEmail || metadata.customerEmail || metadata.email || '',
      paymentOrderId: entry.paymentOrderId || metadata.paymentOrderId || '',
      paidAt: entry.paidAt || metadata.paidAt || '',
      driveUploaded: typeof entry.driveUploaded === 'boolean' ? entry.driveUploaded : metadata.driveUploaded === true,
      driveLink: entry.driveLink || metadata.driveLink || '',
    }
  } catch {
    return entry
  }
}

async function flushSyncOutbox(saved) {
  const pending = await readOutbox()
  let sent = 0
  for (const queuedEntry of pending) {
    const entry = await hydrateLegacySession(queuedEntry)
    const pathName = entry.kind === 'payment'
      ? '/api/device/payments'
      : entry.kind === 'app-run'
        ? '/api/device/runs'
        : '/api/device/sessions'
    await cloudRequest(saved, pathName, { method: 'POST', body: JSON.stringify(entry) })
    const eventId = outboxEventId(entry)
    await mutateOutbox((current) => current.filter((item) => outboxEventId(item) !== eventId))
    sent += 1
  }
  return sent
}

async function enqueueLegacyCustomerEmailRepairs(saved) {
  if (legacyCustomerEmailRepairQueued || !saved?.public?.syncUrl?.trim()) return 0
  const root = await sessionStoragePath()
  const directories = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  let queued = 0
  let complete = true
  for (const entry of directories) {
    if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]{5,100}$/.test(entry.name)) continue
    const sessionId = entry.name
    const directoryPath = path.join(root, sessionId)
    try {
      const info = JSON.parse(await fs.readFile(path.join(directoryPath, 'info.json'), 'utf8'))
      if (typeof info.customerEmail === 'string' && info.customerEmail.trim()) continue
      const customerEmail = typeof info.email === 'string' ? info.email.trim().toLowerCase() : ''
      if (customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) continue
      const operationMode = info.operationMode
      const paymentStatus = info.paymentStatus
      const experience = info.experience
      const statusMatchesMode = (operationMode === 'event' && paymentStatus === 'event')
        || (operationMode === 'dev' && ['paid', 'skipped'].includes(paymentStatus))
        || (operationMode === 'booth' && paymentStatus === 'paid')
      if (!statusMatchesMode || !['single', 'strip'].includes(experience) || !Number.isFinite(Date.parse(info.createdAt))) continue
      const amount = Number.isSafeInteger(info.amount) && info.amount >= 0
        ? info.amount
        : paymentStatus === 'paid' ? sessionPrice(saved, experience) : 0
      await enqueueSyncSession({
        sessionId,
        createdAt: info.createdAt,
        customerEmail,
        paidAt: info.paidAt ?? '',
        operationMode,
        paymentStatus,
        paymentOrderId: typeof info.paymentOrderId === 'string' ? info.paymentOrderId : '',
        experience,
        amount,
        driveUploaded: info.driveUploaded === true,
        driveLink: typeof info.driveLink === 'string' ? info.driveLink : '',
        driveExpiresAt: typeof info.driveExpiresAt === 'string' ? info.driveExpiresAt : '',
      })
      await updateLocalSessionInfo(sessionId, { customerEmail }, directoryPath)
      queued += 1
    } catch (error) {
      complete = false
      console.warn(`[session-email-repair] ${sessionId}:`, error instanceof Error ? error.message : 'Pemulihan email sesi tertunda.')
    }
  }
  if (complete) legacyCustomerEmailRepairQueued = true
  return queued
}

async function runCloudSync(event) {
  if (event && !isTrustedRenderer(event)) throw new Error('Akses sinkronisasi ditolak.')
  if (cloudSyncPromise) return cloudSyncPromise
  const operation = performCloudSync({ manual: Boolean(event) })
  cloudSyncPromise = operation
  try {
    return await operation
  } finally {
    if (cloudSyncPromise === operation) cloudSyncPromise = null
  }
}

async function performCloudSync({ manual = false } = {}) {
  try {
    let saved = await readStoredConfig()
    try {
      await enqueueCurrentAppRun(saved)
    } catch (error) {
      console.error('[booth run log]', error)
      if (maintenanceSyncInProgress) throw error
    }
    await ensureCloudDevice(saved)
    try {
      await enqueueLegacyCustomerEmailRepairs(saved)
    } catch (error) {
      console.warn('[session-email-repair]', error instanceof Error ? error.message : 'Pemulihan email sesi tertunda.')
    }
    const telegramChatIdForCloud = saved.secrets.telegramBotToken ? saved.public.telegramChatId.trim() : ''
    if (saved.telegramChatIdSynced !== telegramChatIdForCloud
      && (telegramChatIdForCloud || saved.telegramChatIdSynced)) {
      try {
        await syncTelegramSettings(saved)
        saved.telegramChatIdSynced = telegramChatIdForCloud
        await writeStoredConfig(saved)
      } catch (error) {
        console.warn('[telegram chat sync]', error instanceof Error ? error.message : 'Chat ID belum tersinkron.')
      }
    }
    let configDeferred = false
    let framesDeferred = false
    const canReadCloudConfig = cloudConfigApplyAllowed || manual || (saved.cloudPending && cloudFrameApplyAllowed)
    if (canReadCloudConfig) {
      let remote
      try {
        remote = await cloudRequest(saved, '/api/device/sync')
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const needsReenrollment = message.includes('Booth menunggu persetujuan Web Admin')
          || message.includes('Booth ini sudah tidak terhubung ke toko aktif')
        if (!needsReenrollment) throw error
        saved.deviceApproved = false
        await writeStoredConfig(saved)
        await ensureCloudDevice(saved)
        remote = await cloudRequest(saved, '/api/device/sync')
      }
      if (Number.isSafeInteger(remote.revision) && remote.revision !== saved.cloudRevision) {
        if (cloudConfigApplyAllowed) {
          saved.public = validatedCloudConfig({ ...remote.config, storeId: remote.storeId }, saved.public)
          saved.cloudRevision = remote.revision
          saved.cloudPending = false
          const apply = writeStoredConfig(saved)
          cloudConfigApplyPromise = apply
          try {
            await apply
          } finally {
            if (cloudConfigApplyPromise === apply) cloudConfigApplyPromise = null
          }
        } else configDeferred = true
      } else if (saved.cloudPending) {
        await pushLocalCloudConfig(saved)
      }
    } else {
      configDeferred = true
    }
    if (cloudFrameApplyAllowed || manual) {
      framesDeferred = await syncCloudFrames(saved, { preferRemote: maintenanceSyncInProgress })
      if (maintenanceSyncInProgress && !framesDeferred) await downloadRemoteFrameAssets(saved)
    }
    else framesDeferred = true
    const sent = await flushSyncOutbox(saved)
    const pendingOutbox = await readOutbox()
    const allSynced = !configDeferred && !framesDeferred
      && saved.cloudPending !== true && saved.frameCloudPending !== true
      && pendingOutbox.length === 0
    const revision = await readConfigRevision()
    const message = !allSynced
      ? `Sinkronisasi tertunda${sent ? `; ${sent} data terkirim` : ''}${pendingOutbox.length ? `; ${pendingOutbox.length} antrean tersisa` : ''}.`
      : sent ? `Konfigurasi tersinkron; ${sent} data terkirim.` : 'Konfigurasi booth tersinkron.'
    return { synced: true, allSynced, deferred: !allSynced, revision, message, framesDeferred }
  } catch (error) {
    return { synced: false, message: error instanceof Error ? error.message : 'Sinkronisasi cloud gagal.' }
  }
}

async function checkCloudUpdates(event) {
  if (event && !isTrustedRenderer(event)) throw new Error('Akses sinkronisasi ditolak.')
  if (cloudUpdateCheckPromise) return cloudUpdateCheckPromise
  if (cloudSyncPromise) return { checked: false, busy: true }

  const operation = performCloudUpdateCheck()
  cloudUpdateCheckPromise = operation
  try {
    return await operation
  } finally {
    if (cloudUpdateCheckPromise === operation) cloudUpdateCheckPromise = null
  }
}

function isWebAdminSaveActive(remote) {
  if (remote?.maintenance?.status !== 'applying') return false
  const updatedAt = new Date(remote.maintenance.updatedAt).getTime()
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt < 5 * 60_000
}

async function performCloudUpdateCheck() {
  try {
    const saved = await readStoredConfig()
    if (!saved?.public?.syncUrl?.trim() || saved.deviceApproved !== true) return { checked: false }

    const remote = await cloudRequest(saved, '/api/device/updates')
    if (!Number.isSafeInteger(remote.configRevision) || !Number.isSafeInteger(remote.frameRevision)) {
      throw new Error('Status revisi dari Web Admin tidak valid.')
    }

    const configChanged = remote.configRevision !== (saved.cloudRevision ?? 0)
    const framesChanged = remote.frameRevision !== (saved.frameCloudRevision ?? 0)
    const remoteChanged = configChanged || framesChanged
    if (isWebAdminSaveActive(remote)) {
      return {
        checked: true,
        changed: true,
        remoteChanged: true,
        deferred: true,
        waitingForWebAdmin: true,
        message: 'WebAdmin masih menyimpan konfigurasi booth dan frame.',
      }
    }
    const configNeedsSync = configChanged || saved.cloudPending === true
    const framesNeedSync = framesChanged || saved.frameCloudPending === true
    if (!configNeedsSync && !framesNeedSync) return { checked: true, changed: false, remoteChanged: false }

    const canSyncConfig = configNeedsSync && cloudConfigApplyAllowed
    const canSyncFrames = framesNeedSync && cloudFrameApplyAllowed
    if (!canSyncConfig && !canSyncFrames) return { checked: true, changed: true, remoteChanged, deferred: true }

    const result = await runCloudSync()
    return { ...result, checked: true, changed: true, remoteChanged, failed: result.synced !== true }
  } catch (error) {
    return {
      checked: false,
      failed: true,
      message: error instanceof Error ? error.message : 'Pemeriksaan pembaruan cloud gagal.',
    }
  }
}

async function setBoothSessionActive(event, active) {
  if (!isTrustedRenderer(event)) throw new Error('Akses status sesi ditolak.')
  boothSessionActive = active === true
  return { active: boothSessionActive }
}

async function synchronizeForMaintenance(event) {
  if (!isTrustedRenderer(event)) throw new Error('Akses sinkronisasi maintenance ditolak.')
  if (boothSessionActive) return { synced: false, allSynced: false, busy: true, message: 'Sesi booth masih berjalan.' }

  maintenanceSyncCheckpoint = null
  let saved = await readStoredConfig()
  if (!saved?.public?.syncUrl?.trim() || saved.deviceApproved !== true) {
    return { synced: false, allSynced: false, message: 'Booth belum tersambung dan disetujui di WebAdmin.' }
  }

  try {
    if (cloudUpdateCheckPromise) await cloudUpdateCheckPromise.catch(() => {})
    if (cloudSyncPromise) await cloudSyncPromise.catch(() => {})
    const before = await cloudRequest(saved, '/api/device/updates')
    if (!Number.isSafeInteger(before.configRevision) || !Number.isSafeInteger(before.frameRevision)) {
      throw new Error('Status sinkronisasi dari WebAdmin tidak valid.')
    }
    if (isWebAdminSaveActive(before)) {
      return { synced: false, allSynced: false, waitingForWebAdmin: true, message: 'Menunggu WebAdmin menyelesaikan perubahan config dan frame.' }
    }

    const restartRequired = before.configRevision !== (saved.cloudRevision ?? 0)
      || before.frameRevision !== (saved.frameCloudRevision ?? 0)
    cloudConfigApplyAllowed = true
    cloudFrameApplyAllowed = true
    maintenanceSyncInProgress = true
    const syncResult = await runCloudSync(event)
    if (syncResult.synced !== true || syncResult.allSynced !== true) {
      return { ...syncResult, allSynced: false, message: syncResult.message || 'Belum semua data tersinkron.' }
    }

    saved = await readStoredConfig()
    const [remote, pendingOutbox] = await Promise.all([
      cloudRequest(saved, '/api/device/updates'),
      readOutbox(),
    ])
    if (isWebAdminSaveActive(remote)) {
      return { synced: false, allSynced: false, waitingForWebAdmin: true, message: 'WebAdmin masih menyimpan perubahan terbaru.' }
    }
    if (remote.configRevision !== saved.cloudRevision || remote.frameRevision !== saved.frameCloudRevision
      || saved.cloudPending === true || saved.frameCloudPending === true || pendingOutbox.length > 0) {
      return { synced: false, allSynced: false, message: 'Ada perubahan atau data baru yang belum tersinkron.' }
    }
    if (remote.maintenance?.status && remote.maintenance.status !== 'ready') {
      return { synced: false, allSynced: false, waitingForWebAdmin: true, message: 'Menunggu WebAdmin menandai perubahan siap diterapkan.' }
    }

    maintenanceSyncCheckpoint = {
      deviceId: saved.deviceId,
      operationId: remote.maintenance?.operationId ?? '',
      configRevision: remote.configRevision,
      frameRevision: remote.frameRevision,
      restartRequired,
      checkedAt: Date.now(),
    }
    return { synced: true, allSynced: true, restartRequired, message: 'Semua konfigurasi, frame, dan antrean data tersinkron.' }
  } catch (error) {
    return { synced: false, allSynced: false, message: error instanceof Error ? error.message : 'Sinkronisasi maintenance gagal.' }
  } finally {
    maintenanceSyncInProgress = false
    cloudConfigApplyAllowed = false
    cloudFrameApplyAllowed = false
    await Promise.all([cloudConfigApplyPromise, cloudFrameApplyPromise].filter(Boolean).map((operation) => operation.catch(() => {})))
  }
}

async function restartAfterMaintenance(event) {
  if (!isTrustedRenderer(event)) throw new Error('Akses restart ditolak.')
  if (boothSessionActive) return { restarting: false, restartRequired: true, message: 'Restart ditunda karena sesi booth masih berjalan.' }
  if (restartScheduled) return { restarting: true, restartRequired: true }
  const checkpoint = maintenanceSyncCheckpoint
  if (!checkpoint || Date.now() - checkpoint.checkedAt > 120_000) {
    return { restarting: false, restartRequired: true, message: 'Status sync sudah kedaluwarsa; memeriksa ulang.' }
  }
  if (!checkpoint.restartRequired) return { restarting: false, restartRequired: false }
  if (cloudSyncPromise || cloudUpdateCheckPromise || cloudConfigApplyPromise || cloudFrameApplyPromise) {
    return { restarting: false, restartRequired: true, message: 'Menunggu operasi sinkronisasi selesai.' }
  }

  try {
    const saved = await readStoredConfig()
    const [remote, pendingOutbox] = await Promise.all([
      cloudRequest(saved, '/api/device/updates'),
      readOutbox(),
    ])
    const sameMaintenance = (remote.maintenance?.operationId ?? '') === checkpoint.operationId
      && (!remote.maintenance?.status || remote.maintenance.status === 'ready' || !isWebAdminSaveActive(remote))
    const allSynced = saved.deviceId === checkpoint.deviceId
      && sameMaintenance
      && remote.configRevision === checkpoint.configRevision
      && remote.frameRevision === checkpoint.frameRevision
      && remote.configRevision === saved.cloudRevision
      && remote.frameRevision === saved.frameCloudRevision
      && saved.cloudPending !== true && saved.frameCloudPending !== true
      && pendingOutbox.length === 0
    if (!allSynced) {
      maintenanceSyncCheckpoint = null
      return { restarting: false, restartRequired: true, message: 'Ada perubahan baru atau antrean sync. Menyinkronkan ulang sebelum restart.' }
    }
  } catch (error) {
    maintenanceSyncCheckpoint = null
    return { restarting: false, restartRequired: true, message: error instanceof Error ? error.message : 'Status sync gagal diverifikasi.' }
  }

  restartScheduled = true
  const developmentReload = !app.isPackaged
  setTimeout(() => {
    if (developmentReload) {
      // `npm run dev` owns the Vite server and stops it when Electron exits.
      // Keep the main process alive in development so the reloaded renderer
      // still has a live server to load from.
      maintenanceSyncCheckpoint = null
      restartScheduled = false
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window && !window.isDestroyed()) window.webContents.reload()
      return
    }

    app.relaunch()
    app.quit()
  }, 400)
  return { restarting: true, restartRequired: true, rendererReloadOnly: developmentReload }
}

async function setSyncApplyAllowed(event, allowed) {
  if (!isTrustedRenderer(event)) throw new Error('Akses sinkronisasi ditolak.')
  cloudConfigApplyAllowed = allowed === true
  if (!cloudConfigApplyAllowed) {
    await Promise.all([cloudConfigApplyPromise].filter(Boolean).map((operation) => operation.catch(() => {})))
  }
  return cloudConfigApplyAllowed
}

async function setFrameSyncApplyAllowed(event, allowed) {
  if (!isTrustedRenderer(event)) throw new Error('Akses sinkronisasi ditolak.')
  cloudFrameApplyAllowed = allowed === true
  if (!cloudFrameApplyAllowed) {
    await Promise.all([cloudFrameApplyPromise].filter(Boolean).map((operation) => operation.catch(() => {})))
  }
  return cloudFrameApplyAllowed
}

async function setCloudApplyAllowed(event, configAllowed, frameAllowed) {
  if (!isTrustedRenderer(event)) throw new Error('Akses sinkronisasi ditolak.')
  const stoppingApply = (cloudConfigApplyAllowed && configAllowed !== true)
    || (cloudFrameApplyAllowed && frameAllowed !== true)
  cloudConfigApplyAllowed = configAllowed === true
  cloudFrameApplyAllowed = frameAllowed === true
  if (stoppingApply) {
    await Promise.all([cloudConfigApplyPromise, cloudFrameApplyPromise].filter(Boolean).map((operation) => operation.catch(() => {})))
  }
  return { config: cloudConfigApplyAllowed, frames: cloudFrameApplyAllowed }
}

async function saveConfig(event, input, frameAssets = []) {
  if (!isTrustedRenderer(event)) throw new Error('Akses konfigurasi ditolak.')
  const previous = await readStoredConfig()
  const config = Object.fromEntries(allowedFields.map((field) => [field, String(input?.[field] ?? '')]))
  config.midtransServerKey = config.midtransServerKey.trim()
  config.telegramBotToken = config.telegramBotToken.trim()
  config.telegramChatId = config.telegramChatId.trim()
  if (config.telegramBotToken && !/^\d{5,20}:[A-Za-z\d_-]{20,220}$/.test(config.telegramBotToken)) {
    throw new Error('Token bot Telegram tidak valid.')
  }
  if (config.telegramChatId && !/^-?\d{1,20}$/.test(config.telegramChatId)) {
    throw new Error('Chat ID Telegram harus berupa angka dari perintah /id bot.')
  }
  config.storagePath = normalizeStoragePath(config.storagePath)
  for (const [field, label] of [['photoStripPrice', 'Harga photo strip'], ['singlePhotoPrice', 'Harga foto tunggal']]) {
    if (!/^\d{1,9}$/.test(config[field]) || Number(config[field]) < 1) throw new Error(`${label} harus berupa angka positif.`)
  }
  if (!/^([1-9]|[1-5]\d|60)$/.test(config.sessionTimeoutMinutes)) throw new Error('Batas waktu sesi harus antara 1 dan 60 menit.')
  config.printerName = config.printerName.trim().slice(0, 240)
  config.printerAutoPrint = config.printerAutoPrint === 'false' ? 'false' : 'true'
  if (!['photo4x6', 'photo4x8', 'a4', 'a3', 'printer'].includes(config.printerPaperSize)) {
    throw new Error('Ukuran kertas printer tidak valid.')
  }
  if (!/^[1-5]$/.test(config.printerCopies)) throw new Error('Jumlah salinan printer harus antara 1 dan 5.')
  if (!['color', 'grayscale'].includes(config.printerColor)) throw new Error('Mode warna printer tidak valid.')
  if (!/^\d{1,4}$/.test(config.googleDriveRetentionDays) || retentionDaysFromValue(config.googleDriveRetentionDays, 0) === 0) {
    throw new Error(`Retensi Google Drive harus antara 1 dan ${maxDriveRetentionDays} hari.`)
  }
  if (config.googleDriveEnabled !== 'true' && config.googleDriveEnabled !== 'false') throw new Error('Pengaturan upload Google Drive tidak valid.')
  if (!isValidGoogleDriveFolderPath(config.googleDriveFolder)) throw new Error('Folder Google Drive tidak valid. Gunakan nama folder atau path subfolder tanpa segmen kosong atau ..')
  const encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable()
  if (!encryptionAvailable && secretFields.some((field) => config[field])) {
    throw new Error('Penyimpanan terenkripsi dari sistem operasi tidak tersedia.')
  }
  const publicConfig = { ...config }
  const secrets = {}
  Object.assign(secrets, previous?.secrets ?? {})
  delete secrets.smtpUser
  delete secrets.smtpPassword
  for (const field of secretFields) {
    delete publicConfig[field]
    if (!config[field] && previous?.secrets?.[field]) {
      secrets[field] = previous.secrets[field]
      continue
    }
    secrets[field] = config[field]
      ? (await safeStorage.encryptStringAsync(config[field])).toString('base64')
      : ''
  }
  const saved = {
    public: publicConfig,
    secrets,
    deviceId: previous?.deviceId,
    devicePublicKey: previous?.devicePublicKey,
    deviceApproved: previous?.deviceApproved,
    cloudRevision: previous?.cloudRevision ?? 0,
    cloudPending: Boolean(publicConfig.syncUrl),
    frameCloudRevision: previous?.frameCloudRevision ?? 0,
    frameCloudPending: Boolean(previous?.frameCloudPending),
  }
  const frameResult = await persistFrameSettings(input?.boothFrames ?? serializeFrameManifest(await readFrameManifest()), frameAssets)
  saved.frameCloudPending = Boolean(saved.frameCloudPending || ((frameResult.changed || !previous?.public?.syncUrl || (frameResult.manifest.frames.length && !previous?.frameCloudRevision)) && publicConfig.syncUrl))
  await writeStoredConfig(saved)
  setTimeout(() => { void runDriveRetentionCleanup().catch(() => {}) }, 1000)
  telegramBot.start()
  let syncStatus = ''
  let syncError = ''
  let telegramStatus = ''
  let telegramError = ''
  if (publicConfig.syncUrl) {
    try {
      await pushLocalCloudConfig(saved)
      if (saved.frameCloudPending) await pushLocalCloudFrames(saved)
      syncStatus = 'synced'
    } catch (error) {
      syncStatus = 'pending'
      syncError = error instanceof Error ? error.message : 'Perangkat tersimpan lokal; sinkronisasi cloud tertunda.'
    }
    const telegramChatIdForCloud = saved.secrets.telegramBotToken ? saved.public.telegramChatId.trim() : ''
    if (saved.telegramChatIdSynced !== telegramChatIdForCloud
      && (telegramChatIdForCloud || saved.telegramChatIdSynced || (previous?.public?.telegramChatId && !saved.public.telegramChatId))) {
      try {
        const telegram = await syncTelegramSettings(saved)
        saved.telegramChatIdSynced = telegramChatIdForCloud
        await writeStoredConfig(saved)
        telegramStatus = saved.secrets.telegramBotToken ? (telegram.chatConfigured ? 'ready' : 'setup') : ''
      } catch (error) {
        telegramStatus = 'pending'
        telegramError = error instanceof Error ? error.message : 'Pengaturan Telegram belum tersinkron.'
      }
    }
    if (!telegramStatus && saved.secrets.telegramBotToken) telegramStatus = saved.public.telegramChatId ? 'pending' : 'setup'
  } else if (saved.secrets.telegramBotToken) {
    telegramStatus = 'pending'
    telegramError = 'Atur URL Web Admin dan simpan koneksi sebelum mengaktifkan Telegram.'
  }
  return { saved: true, revision: await readConfigRevision(), syncStatus, syncError, telegramStatus, telegramError }
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
  verifiedPaymentOrders.set(orderId, {
    verified: false,
    createdAt: Date.now(),
    amount,
    experience,
    operationMode,
    paymentEnvironment: saved?.public?.paymentEnvironment === 'production' ? 'production' : 'sandbox',
  })
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
  const status = typeof result.transaction_status === 'string' ? result.transaction_status : 'unknown'
  const paid = status === 'settlement' || (status === 'capture' && result.fraud_status === 'accept')
  if (paid) {
    payment.verified = true
    payment.paidAt ??= new Date().toISOString()
    if (!payment.syncQueued) {
      try {
        await enqueueSyncPayment({
          paymentOrderId: orderId,
          paidAt: payment.paidAt,
          amount: payment.amount,
          experience: payment.experience,
          operationMode: payment.operationMode,
          paymentEnvironment: payment.paymentEnvironment,
        })
        payment.syncQueued = true
        payment.syncQueueError = ''
      } catch (error) {
        payment.syncQueueError = error instanceof Error ? error.message : 'Antrean transaksi cloud gagal dibuat.'
      }
    }
  }
  const terminal = ['deny', 'cancel', 'expire', 'failure', 'refund', 'partial_refund', 'chargeback'].includes(status)
  if (terminal) verifiedPaymentOrders.delete(orderId)
  return { paid, status, terminal }
}

async function testGoogleDrive(event) {
  if (!isTrustedRenderer(event)) throw new Error('Akses pengujian Google Drive ditolak.')
  const saved = await readStoredConfig()
  const email = saved?.public?.googleDriveAccountEmail
  if (!email) throw new Error('Hubungkan akun Google Drive terlebih dahulu.')
  const account = await googleDriveAccountFor(saved, email)
  const connectedAccount = await getGoogleDriveAccountEmail(account)
  return { message: 'Koneksi Google Drive berhasil.', account: connectedAccount }
}



async function connectGoogleDrive(event, credentials) {
  if (!isTrustedRenderer(event)) throw new Error('Akses koneksi Google Drive ditolak.')
  const saved = await readStoredConfig() ?? { public: {}, secrets: {} }
  const clientId = typeof credentials?.clientId === 'string' && credentials.clientId.trim()
    ? credentials.clientId.trim()
    : saved?.public?.googleDriveClientId?.trim()
  const providedSecret = typeof credentials?.clientSecret === 'string' ? credentials.clientSecret.trim() : ''
  const savedClientId = typeof saved?.public?.googleDriveClientId === 'string'
    ? saved.public.googleDriveClientId.trim()
    : ''
  const encryptedSecret = savedClientId === clientId ? saved?.secrets?.googleDriveClientSecret : ''
  if (!clientId) throw new Error('Isi OAuth Client ID aplikasi Desktop sebelum menghubungkan akun.')
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Penyimpanan aman sistem operasi tidak tersedia untuk Google Drive.')
  const storedSecret = encryptedSecret ? await decryptStoredString(Buffer.from(encryptedSecret, 'base64')) : ''
  const clientSecret = providedSecret || storedSecret
  if (!clientSecret) throw new Error('Google meminta Client Secret untuk OAuth Client ID ini. Isi Client Secret dari client yang sama.')
  const result = await authorizeGoogleDrive({ clientId, clientSecret, openExternal: (url) => shell.openExternal(url) })
  const accounts = await readGoogleDriveAccounts(saved)
  const previousAccount = accounts.find((account) => account.email === result.email && account.clientId === clientId)
  const refreshToken = result.refreshToken || previousAccount?.refreshToken
  if (!refreshToken) throw new Error('Google tidak mengirim refresh token. Coba hubungkan ulang dan setujui akses Drive.')
  const nextAccount = { email: result.email, clientId, clientSecret, refreshToken }
  const nextAccounts = [...accounts.filter((account) => account.email !== result.email), nextAccount]
  saved.public ??= {}
  saved.secrets ??= {}
  saved.public.googleDriveClientId = clientId
  saved.public.googleDriveAccountEmail = result.email
  if (providedSecret) saved.secrets.googleDriveClientSecret = (await safeStorage.encryptStringAsync(providedSecret)).toString('base64')
  await writeGoogleDriveAccounts(saved, nextAccounts)
  await writeStoredConfig(saved)
  return { message: 'Akun Google Drive berhasil dihubungkan.', account: result.email }
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
  telegramBot.start()
  session.defaultSession.on('will-download', (event, item) => {
    const mimeType = item.getMimeType().toLowerCase()
    const filename = item.getFilename()
    const imageFilename = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(filename)
    const initiatorOrigin = typeof item.getInitiatorOrigin === 'function' ? item.getInitiatorOrigin() : ''
    const fromSnap = [initiatorOrigin, item.getURL()].some((value) => {
      try {
        return ['app.midtrans.com', 'app.sandbox.midtrans.com'].includes(new URL(value).hostname)
      } catch {
        return false
      }
    })
    if (fromSnap || mimeType.startsWith('image/') || imageFilename) event.preventDefault()
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const videoOnly = permission === 'media'
      && details.mediaTypes?.includes('video')
      && !details.mediaTypes?.includes('audio')
    callback(Boolean(videoOnly))
  })
  ipcMain.handle('config:load', loadConfig)
  ipcMain.handle('config:revision', getConfigRevision)
  ipcMain.handle('config:save', saveConfig)
  ipcMain.handle('printer:list', listPrinters)
  ipcMain.handle('printer:test', testPrinter)
  ipcMain.handle('frame:load', loadFrameAsset)
  ipcMain.handle('sync:now', runCloudSync)
  ipcMain.handle('sync:check-updates', checkCloudUpdates)
  ipcMain.handle('sync:apply-allowed', setSyncApplyAllowed)
  ipcMain.handle('sync:frame-apply-allowed', setFrameSyncApplyAllowed)
  ipcMain.handle('sync:apply-allowed-both', setCloudApplyAllowed)
  ipcMain.handle('session:set-active', setBoothSessionActive)
  ipcMain.handle('sync:maintenance', synchronizeForMaintenance)
  ipcMain.handle('app:restart-after-maintenance', restartAfterMaintenance)
  ipcMain.handle('session:save', saveSession)
  ipcMain.handle('session:abandoned', notifyAbandonedSession)
  ipcMain.handle('storage:choose-path', chooseStoragePath)
  ipcMain.handle('payment:create-midtrans', createMidtransPayment)
  ipcMain.handle('payment:verify-midtrans', verifyMidtransPayment)
  ipcMain.handle('google-drive:test', testGoogleDrive)
  ipcMain.handle('google-drive:connect', connectGoogleDrive)
  setTimeout(() => { void runCloudSync() }, 5000)
  setInterval(() => { void runCloudSync() }, 30000)
  setTimeout(() => {
    void runDriveRetentionCleanup().catch((error) => console.warn('[drive-retention]', error instanceof Error ? error.message : 'Pemeriksaan retensi tertunda.'))
  }, 20000)
  setInterval(() => {
    void runDriveRetentionCleanup().catch((error) => console.warn('[drive-retention]', error instanceof Error ? error.message : 'Pemeriksaan retensi tertunda.'))
  }, 15 * 60 * 1000)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => telegramBot.stop())
