import { createCipheriv, createDecipheriv, createHmac, createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto'
import { MongoClient, type Db, type Document } from 'mongodb'
import { MAX_API_BODY_BYTES, MAX_REMOTE_CONFIG_BYTES, MAX_REMOTE_CONFIG_FIELD_BYTES } from './configLimits'

export type VercelRequest = {
  method?: string
  url?: string
  headers: {
    cookie?: string
    authorization?: string
    'x-booth-id'?: string
    'x-booth-time'?: string
    'x-booth-nonce'?: string
    'x-booth-signature'?: string
  }
  body?: unknown
  query: Record<string, string | string[] | undefined>
}

export type VercelResponse = {
  status(code: number): VercelResponse
  setHeader(name: string, value: string | number | readonly string[]): VercelResponse
  json(body: unknown): void
  end(body?: string | Buffer): void
}

type StringIdDocument = Document & { _id: string }

export function stringIdCollection(db: Db, name: string) {
  return db.collection<StringIdDocument>(name)
}

declare global {
  // Reuse the Mongo pool across Vercel function invocations in a warm instance.
  var captursMongoClient: Promise<MongoClient> | undefined
  var captursDeviceNonceIndex: Promise<string> | undefined
}

export const ADMIN_COOKIE = 'capturs_admin'
export const SESSION_SECONDS = 60 * 60 * 24 * 7
const SETTINGS_ID = 'main'
export type RemoteBoothConfig = {
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
}

export type RemoteFrame = {
  id: string
  name: string
  width: number
  height: number
  appliesTo: 'strip' | 'single' | 'both'
  slots: Record<string, unknown>[]
  assetHash: string
  thumbnailDataUrl: string
  dataUrl: string
}

export type DeviceFrameManifest = { activeFrameId: string; frames: RemoteFrame[] }
export type DeviceFrameManifestDocument = {
  _id: string
  storeId: string
  manifest: DeviceFrameManifest
  revision: number
  updatedAt: Date
}

export type DeviceConfigDocument = {
  _id: string
  storeId: string
  config: RemoteBoothConfig
  revision: number
  updatedAt: Date
}

export type AppSettings = {
  storeId: string
  storeName: string
  photoStripPrice: string
  singlePhotoPrice: string
  sessionTimeoutMinutes: string
  operationMode: 'dev' | 'booth' | 'event'
  paymentEnvironment: 'sandbox' | 'production'
  midtransClientKey: string
  revision: number
  updatedAt: Date
}

export type EmailSettingsRecord = {
  _id: string
  enabled: boolean
  mode: 'smtp' | 'gmail'
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  fromName: string
  fromAddress: string
  usernameEncrypted: string
  passwordEncrypted: string
  revision: number
  updatedAt: Date
}

export type PublicEmailSettings = Omit<EmailSettingsRecord, '_id' | 'usernameEncrypted' | 'passwordEncrypted'> & {
  usernameConfigured: boolean
  passwordConfigured: boolean
}

export function json(res: VercelResponse, status: number, payload: unknown) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(payload)
}

export function methodNotAllowed(res: VercelResponse, methods: string[]) {
  res.setHeader('Allow', methods.join(', '))
  json(res, 405, { error: 'Metode request tidak didukung.' })
}

export function readBody(req: VercelRequest) {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Isi request tidak valid.')
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_API_BODY_BYTES) throw new Error('Isi request melewati batas 4,49 MB.')
  return body as Record<string, unknown>
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function signedRequestPath(req: VercelRequest) {
  const parsed = new URL(req.url ?? '/', 'https://capturs.invalid')
  return `${parsed.pathname}${parsed.search}`
}

export function validateDevicePublicKey(value: unknown) {
  if (typeof value !== 'string' || value.length > 500) throw new Error('Identitas kriptografis booth tidak valid.')
  try {
    const key = createPublicKey(value)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Jenis kunci tidak didukung.')
    return key.export({ type: 'spki', format: 'pem' }).toString()
  } catch {
    throw new Error('Identitas kriptografis booth tidak valid.')
  }
}

export async function consumeDeviceProof(db: Db, req: VercelRequest, publicKey: string, deviceId: string): Promise<'accepted' | 'invalid' | 'replayed'> {
  const timestamp = req.headers['x-booth-time'] ?? ''
  const nonce = req.headers['x-booth-nonce'] ?? ''
  const signature = req.headers['x-booth-signature'] ?? ''
  const timestampNumber = Number(timestamp)
  if (!/^[a-f\d-]{36}$/i.test(deviceId) || !Number.isSafeInteger(timestampNumber)
    || Math.abs(Date.now() - timestampNumber) > 5 * 60_000 || !/^[a-f\d-]{36}$/i.test(nonce) || !signature
    || req.headers['x-booth-id'] !== deviceId) return 'invalid'
  let bodyValue: unknown
  try { bodyValue = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch { return 'invalid' }
  const bodyHash = createHash('sha256').update(req.body === undefined ? '' : stableJson(bodyValue)).digest('hex')
  const method = (req.method ?? 'GET').toUpperCase()
  const message = `${method}\n${signedRequestPath(req)}\n${timestamp}\n${nonce}\n${bodyHash}`
  let validSignature = false
  try { validSignature = verify(null, Buffer.from(message), publicKey, Buffer.from(signature, 'base64url')) } catch { validSignature = false }
  if (!validSignature) return 'invalid'
  try {
    const nonces = stringIdCollection(db, 'device_request_nonces')
    if (!global.captursDeviceNonceIndex) {
      global.captursDeviceNonceIndex = nonces.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    }
    try {
      await global.captursDeviceNonceIndex
    } catch (error) {
      global.captursDeviceNonceIndex = undefined
      throw error
    }
    await nonces.insertOne({ _id: `${deviceId}:${nonce}`, expiresAt: new Date(Date.now() + 10 * 60_000) })
  } catch {
    return 'replayed'
  }
  return 'accepted'
}

export function env(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Environment variable ${name} belum diatur.`)
  return value
}

export function changedFieldNames(before: Record<string, unknown>, after: Record<string, unknown>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => stableJson(before[key]) !== stableJson(after[key]))
}

function safeTelegramText(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500)
}

export async function queueTelegramLog(db: Db, storeId: string, title: string, details: string[], eventId: string = randomUUID()) {
  const integration = await stringIdCollection(db, 'telegram_integrations').findOne(
    { _id: storeId, storeId },
    { projection: { chatId: 1 } },
  )
  if (typeof integration?.chatId !== 'string' || !integration.chatId) return false

  const timestamp = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date())
  const text = [
    `Capturs WebAdmin · ${safeTelegramText(title)}`,
    `Waktu: ${timestamp} WIB`,
    ...details.map(safeTelegramText).filter(Boolean),
  ].join('\n').slice(0, 3900)
  await stringIdCollection(db, 'telegram_outbox').updateOne(
    { _id: eventId },
    { $setOnInsert: { storeId, text, status: 'pending', attempts: 0, availableAt: new Date(), createdAt: new Date() } },
    { upsert: true },
  )
  return true
}

export async function queueTelegramLogSafely(db: Db, storeId: string, title: string, details: string[], eventId?: string) {
  try {
    return await queueTelegramLog(db, storeId, title, details, eventId)
  } catch {
    console.error('[telegram outbox] failed to queue a notification')
    return false
  }
}

export async function database(): Promise<Db> {
  const uri = env('MONGODB_URI')
  if (!global.captursMongoClient) {
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 })
    global.captursMongoClient = client.connect()
  }
  const client = await global.captursMongoClient
  return client.db(process.env.MONGODB_DATABASE?.trim() || 'capturs')
}

export async function ensureSettings(db: Db): Promise<AppSettings> {
  const collection = db.collection<AppSettings>('settings')
  await collection.updateOne(
    { _id: SETTINGS_ID as never },
    { $setOnInsert: {
      storeId: `capturs-${randomUUID().slice(0, 8)}`,
      storeName: 'Capturs Photobooth',
      photoStripPrice: '35000',
      singlePhotoPrice: '24500',
      sessionTimeoutMinutes: '5',
      operationMode: 'dev',
      paymentEnvironment: 'sandbox',
      midtransClientKey: '',
      revision: 1,
      updatedAt: new Date(),
    } },
    { upsert: true },
  )
  let settings = await collection.findOne({ _id: SETTINGS_ID as never }) as (AppSettings & { price?: string }) | null
  if (!settings) throw new Error('Pengaturan toko tidak dapat dibuat.')
  const legacyPrice = Number(settings.price)
  const stripPrice = /^\d{1,9}$/.test(String(settings.photoStripPrice ?? '')) && Number(settings.photoStripPrice) > 0
    ? settings.photoStripPrice
    : Number.isSafeInteger(legacyPrice) && legacyPrice > 0 ? String(legacyPrice) : '35000'
  const singlePrice = /^\d{1,9}$/.test(String(settings.singlePhotoPrice ?? '')) && Number(settings.singlePhotoPrice) > 0
    ? settings.singlePhotoPrice
    : Number.isSafeInteger(legacyPrice) && legacyPrice > 0 ? String(Math.round(legacyPrice * 0.7)) : '24500'
  const sessionTimeoutMinutes = /^([1-9]|[1-5]\d|60)$/.test(String(settings.sessionTimeoutMinutes ?? '')) ? settings.sessionTimeoutMinutes : '5'
  if (settings.photoStripPrice !== stripPrice || settings.singlePhotoPrice !== singlePrice || settings.sessionTimeoutMinutes !== sessionTimeoutMinutes || settings.price !== undefined) {
    const updatedAt = new Date()
    await collection.updateOne(
      { _id: SETTINGS_ID as never, revision: settings.revision },
      { $set: { photoStripPrice: stripPrice, singlePhotoPrice: singlePrice, sessionTimeoutMinutes, revision: settings.revision + 1, updatedAt }, $unset: { price: '' } },
    )
    settings = await collection.findOne({ _id: SETTINGS_ID as never }) as (AppSettings & { price?: string }) | null
    if (!settings) throw new Error('Pengaturan toko tidak dapat dibaca.')
  }
  return settings
}

export function cleanSettings(settings: AppSettings) {
  return {
    storeId: settings.storeId,
    storeName: settings.storeName,
    photoStripPrice: settings.photoStripPrice,
    singlePhotoPrice: settings.singlePhotoPrice,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    operationMode: settings.operationMode,
    paymentEnvironment: settings.paymentEnvironment,
    midtransClientKey: settings.midtransClientKey,
    revision: settings.revision,
    updatedAt: settings.updatedAt,
  }
}

export function validateSettings(input: Record<string, unknown>, current: AppSettings) {
  const next = { ...current }
  if (input.storeName !== undefined) {
    if (typeof input.storeName !== 'string' || !input.storeName.trim() || input.storeName.trim().length > 100) throw new Error('Nama booth wajib diisi dan maksimal 100 karakter.')
    next.storeName = input.storeName.trim()
  }
  const legacyPriceProvided = input.price !== undefined && input.photoStripPrice === undefined
  const photoStripPrice = input.photoStripPrice ?? (legacyPriceProvided ? input.price : undefined)
  if (photoStripPrice !== undefined) {
    const value = String(photoStripPrice)
    if (!/^\d{1,9}$/.test(value) || Number(value) < 1) throw new Error('Harga photo strip harus berupa angka positif.')
    next.photoStripPrice = value
    if (legacyPriceProvided && input.singlePhotoPrice === undefined && !/^\d{1,9}$/.test(String(current.singlePhotoPrice ?? ''))) next.singlePhotoPrice = '24500'
  }
  if (input.singlePhotoPrice !== undefined) {
    const value = String(input.singlePhotoPrice)
    if (!/^\d{1,9}$/.test(value) || Number(value) < 1) throw new Error('Harga foto tunggal harus berupa angka positif.')
    next.singlePhotoPrice = value
  }
  if (input.sessionTimeoutMinutes !== undefined) {
    const value = String(input.sessionTimeoutMinutes)
    if (!/^([1-9]|[1-5]\d|60)$/.test(value)) throw new Error('Batas waktu sesi harus antara 1 dan 60 menit.')
    next.sessionTimeoutMinutes = value
  }
  if (input.operationMode !== undefined) {
    if (!['dev', 'booth', 'event'].includes(String(input.operationMode))) throw new Error('Mode operasi tidak valid.')
    next.operationMode = input.operationMode as AppSettings['operationMode']
  }
  if (input.paymentEnvironment !== undefined) {
    if (!['sandbox', 'production'].includes(String(input.paymentEnvironment))) throw new Error('Environment pembayaran tidak valid.')
    next.paymentEnvironment = input.paymentEnvironment as AppSettings['paymentEnvironment']
  }
  if (input.midtransClientKey !== undefined) {
    if (typeof input.midtransClientKey !== 'string' || input.midtransClientKey.length > 200) throw new Error('Client Key Midtrans tidak valid.')
    next.midtransClientKey = input.midtransClientKey.trim()
  }
  return next
}

export async function saveSettings(db: Db, input: Record<string, unknown>, expectedRevision?: number) {
  const current = await ensureSettings(db)
  if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new Error('Konfigurasi sudah berubah di cloud. Segarkan pengaturan sebelum menyimpan lagi.')
  const next = validateSettings(input, current)
  next.revision = current.revision + 1
  next.updatedAt = new Date()
  const result = await db.collection('settings').updateOne(
    { _id: SETTINGS_ID as never, revision: current.revision },
    { $set: {
      storeId: next.storeId,
      storeName: next.storeName,
      photoStripPrice: next.photoStripPrice,
      singlePhotoPrice: next.singlePhotoPrice,
      sessionTimeoutMinutes: next.sessionTimeoutMinutes,
      operationMode: next.operationMode,
      paymentEnvironment: next.paymentEnvironment,
      midtransClientKey: next.midtransClientKey,
      revision: next.revision,
      updatedAt: next.updatedAt,
    } },
  )
  if (result.matchedCount !== 1) throw new Error('Konfigurasi sudah berubah di cloud. Segarkan pengaturan sebelum menyimpan lagi.')
  return next
}

const EMAIL_SETTINGS_ID = 'main'

export async function ensureEmailSettings(db: Db) {
  const collection = db.collection<EmailSettingsRecord>('email_settings')
  await collection.updateOne(
    { _id: EMAIL_SETTINGS_ID },
    { $setOnInsert: {
      enabled: false,
      mode: 'smtp',
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: false,
      fromName: 'Capturs Photobooth',
      fromAddress: '',
      usernameEncrypted: '',
      passwordEncrypted: '',
      revision: 1,
      updatedAt: new Date(),
    } },
    { upsert: true },
  )
  return (await collection.findOne({ _id: EMAIL_SETTINGS_ID })) as EmailSettingsRecord
}

export function cleanEmailSettings(settings: EmailSettingsRecord): PublicEmailSettings {
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpSecure: settings.smtpSecure,
    fromName: settings.fromName,
    fromAddress: settings.fromAddress,
    usernameConfigured: Boolean(settings.usernameEncrypted),
    passwordConfigured: Boolean(settings.passwordEncrypted),
    revision: settings.revision,
    updatedAt: settings.updatedAt,
  }
}

export function decryptEmailSecret(encrypted: string) {
  const [version, ivValue, tagValue, cipherValue, extra] = encrypted.split('.')
  if (version !== 'v1' || !ivValue || !tagValue || !cipherValue || extra) throw new Error('Kredensial email tersimpan tidak valid. Masukkan ulang di WebAdmin.')
  try {
    const decipher = createDecipheriv('aes-256-gcm', emailSettingsKey(), Buffer.from(ivValue, 'base64url'))
    decipher.setAAD(Buffer.from('capturs-email-settings-v1'))
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(cipherValue, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Kredensial email tidak dapat dibuka. Masukkan ulang di WebAdmin.')
  }
}

function encryptEmailSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', emailSettingsKey(), iv)
  cipher.setAAD(Buffer.from('capturs-email-settings-v1'))
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}

function emailSettingsKey() {
  return createHmac('sha256', sessionSecret()).update('capturs:webadmin-email-settings:v1').digest()
}

export async function emailCredentials(settings: EmailSettingsRecord) {
  if (!settings.usernameEncrypted || !settings.passwordEncrypted) throw new Error('Username dan password email belum disimpan di WebAdmin.')
  return {
    username: decryptEmailSecret(settings.usernameEncrypted),
    password: decryptEmailSecret(settings.passwordEncrypted),
  }
}

export async function saveEmailSettings(db: Db, input: Record<string, unknown>, expectedRevision?: number) {
  const collection = db.collection<EmailSettingsRecord>('email_settings')
  const current = await ensureEmailSettings(db)
  if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new Error('Pengaturan email sudah berubah. Segarkan halaman sebelum menyimpan lagi.')
  const mode = input.mode === undefined ? current.mode : input.mode
  if (mode !== 'smtp' && mode !== 'gmail') throw new Error('Pilih mode SMTP atau Gmail.')
  const enabled = input.enabled === undefined ? current.enabled : input.enabled
  if (typeof enabled !== 'boolean') throw new Error('Status email tidak valid.')
  const modeChanged = mode !== current.mode
  const usernameInput = typeof input.username === 'string' ? input.username.trim() : ''
  let passwordInput = typeof input.password === 'string' ? input.password : ''
  if (mode === 'gmail') passwordInput = passwordInput.replace(/\s/g, '')
  if (usernameInput.length > 320 || passwordInput.length > 1024) throw new Error('Kredensial email terlalu panjang.')

  let previousUsername = ''
  if (!modeChanged && current.usernameEncrypted && usernameInput) previousUsername = decryptEmailSecret(current.usernameEncrypted)
  const usernameChanged = Boolean(usernameInput && previousUsername && usernameInput !== previousUsername)
  const gmailAccountChanged = mode === 'gmail' && current.mode === 'gmail' && usernameInput
    ? usernameInput.toLowerCase() !== current.fromAddress.toLowerCase()
    : false
  const canKeepSecrets = !modeChanged && !usernameChanged && !gmailAccountChanged
  const usernameEncrypted = usernameInput
    ? encryptEmailSecret(mode === 'gmail' ? usernameInput.toLowerCase() : usernameInput)
    : canKeepSecrets ? current.usernameEncrypted : ''
  const passwordEncrypted = passwordInput
    ? encryptEmailSecret(passwordInput)
    : canKeepSecrets ? current.passwordEncrypted : ''
  const fromName = typeof input.fromName === 'string' ? input.fromName.trim().slice(0, 100) : current.fromName
  if (!fromName || /[\r\n]/.test(fromName)) throw new Error('Nama pengirim tidak valid.')

  const smtpHost = typeof input.smtpHost === 'string' ? input.smtpHost.trim() : current.smtpHost
  const smtpPort = input.smtpPort === undefined ? current.smtpPort : Number(input.smtpPort)
  const smtpSecure = input.smtpSecure === undefined ? current.smtpSecure : input.smtpSecure
  if (mode === 'smtp') {
    if (typeof smtpSecure !== 'boolean') throw new Error('Pengaturan keamanan SMTP tidak valid.')
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error('Port SMTP harus berupa angka antara 1 dan 65535.')
    if (smtpPort === 25) throw new Error('Vercel memblokir port SMTP 25. Gunakan port 465, 587, atau port lain dari penyedia email.')
    if (smtpHost.length > 253 || /[\s/]/.test(smtpHost)) throw new Error('SMTP Host tidak valid.')
  }

  let fromAddress = typeof input.fromAddress === 'string' ? input.fromAddress.trim().toLowerCase() : current.fromAddress
  if (mode === 'gmail') {
    fromAddress = (usernameInput || (!modeChanged ? current.fromAddress : '')).toLowerCase()
    if (usernameInput && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) throw new Error('Masukkan alamat akun Google yang valid.')
    if (passwordInput && !/^[a-z\d]{16}$/i.test(passwordInput)) throw new Error('Gmail App Password harus berisi 16 karakter; spasi akan dihapus otomatis.')
  } else if (fromAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    throw new Error('Email pengirim SMTP tidak valid.')
  }
  if (enabled) {
    if (!usernameEncrypted || !passwordEncrypted) throw new Error('Isi username dan password email sebelum mengaktifkan pengiriman.')
    if (mode === 'gmail' && !fromAddress) throw new Error('Isi akun Gmail yang digunakan untuk mengirim.')
    if (mode === 'smtp' && (!smtpHost || !fromAddress)) throw new Error('Isi SMTP Host dan email pengirim yang sudah diverifikasi.')
  }

  const next: EmailSettingsRecord = {
    _id: EMAIL_SETTINGS_ID,
    enabled,
    mode,
    smtpHost: mode === 'gmail' ? 'smtp.gmail.com' : smtpHost,
    smtpPort: mode === 'gmail' ? 465 : smtpPort,
    smtpSecure: mode === 'gmail' ? true : smtpSecure,
    fromName,
    fromAddress,
    usernameEncrypted,
    passwordEncrypted,
    revision: current.revision + 1,
    updatedAt: new Date(),
  }
  const { _id: _settingsId, ...updateFields } = next
  const result = await collection.updateOne(
    { _id: EMAIL_SETTINGS_ID, revision: current.revision },
    { $set: updateFields },
  )
  if (result.matchedCount !== 1) throw new Error('Pengaturan email sudah berubah. Segarkan halaman sebelum menyimpan lagi.')
  return next
}

export function sanitizeRemoteConfig(input: Record<string, unknown>, current: RemoteBoothConfig): RemoteBoothConfig {
  const next = { ...current } as RemoteBoothConfig & { boothFrames?: string }
  delete next.boothFrames
  if (input.storeName !== undefined) {
    if (typeof input.storeName !== 'string' || !input.storeName.trim() || input.storeName.trim().length > 100) throw new Error('Nama booth wajib diisi dan maksimal 100 karakter.')
    next.storeName = input.storeName.trim()
  }
  const legacyPriceProvided = input.price !== undefined && input.photoStripPrice === undefined
  const photoStripPrice = input.photoStripPrice ?? (legacyPriceProvided ? input.price : undefined)
  if (photoStripPrice !== undefined) {
    const value = String(photoStripPrice)
    if (!/^\d{1,9}$/.test(value) || Number(value) < 1) throw new Error('Harga photo strip harus berupa angka positif.')
    next.photoStripPrice = value
    if (legacyPriceProvided && input.singlePhotoPrice === undefined && !/^\d{1,9}$/.test(String(current.singlePhotoPrice ?? ''))) next.singlePhotoPrice = '24500'
  }
  if (input.singlePhotoPrice !== undefined) {
    const value = String(input.singlePhotoPrice)
    if (!/^\d{1,9}$/.test(value) || Number(value) < 1) throw new Error('Harga foto tunggal harus berupa angka positif.')
    next.singlePhotoPrice = value
  }
  if (input.sessionTimeoutMinutes !== undefined) {
    const value = String(input.sessionTimeoutMinutes)
    if (!/^([1-9]|[1-5]\d|60)$/.test(value)) throw new Error('Batas waktu sesi harus antara 1 dan 60 menit.')
    next.sessionTimeoutMinutes = value
  }
  if (input.operationMode !== undefined) {
    if (!['dev', 'booth', 'event'].includes(String(input.operationMode))) throw new Error('Mode operasi tidak valid.')
    next.operationMode = input.operationMode as RemoteBoothConfig['operationMode']
  }
  if (input.paymentEnvironment !== undefined) {
    if (!['sandbox', 'production'].includes(String(input.paymentEnvironment))) throw new Error('Environment pembayaran tidak valid.')
    next.paymentEnvironment = input.paymentEnvironment as RemoteBoothConfig['paymentEnvironment']
  }
  if (input.midtransClientKey !== undefined) {
    if (typeof input.midtransClientKey !== 'string' || input.midtransClientKey.length > 200) throw new Error('Client Key Midtrans tidak valid.')
    next.midtransClientKey = input.midtransClientKey.trim()
  }
  if (input.googleDriveEnabled !== undefined) {
    if (input.googleDriveEnabled !== 'true' && input.googleDriveEnabled !== 'false') throw new Error('Pengaturan upload Google Drive tidak valid.')
    next.googleDriveEnabled = input.googleDriveEnabled
  }
  if (input.googleDriveFolder !== undefined) {
    if (typeof input.googleDriveFolder !== 'string' || !input.googleDriveFolder.trim() || input.googleDriveFolder.length > 500 || input.googleDriveFolder.includes(':')) {
      throw new Error('Path folder Google Drive tidak valid.')
    }
    const folderSegments = input.googleDriveFolder.trim().replace(/\\/g, '/').split('/')
    if (folderSegments.some((segment) => !segment.trim() || segment === '.' || segment === '..' || segment.trim().length > 100)) {
      throw new Error('Path folder Google Drive tidak valid.')
    }
    next.googleDriveFolder = input.googleDriveFolder.trim()
  }
  if (input.googleDriveRetentionDays !== undefined) {
    if (typeof input.googleDriveRetentionDays !== 'string' || !/^\d{1,4}$/.test(input.googleDriveRetentionDays)
      || Number(input.googleDriveRetentionDays) < 1 || Number(input.googleDriveRetentionDays) > 3650) {
      throw new Error('Retensi Google Drive harus antara 1 dan 3650 hari.')
    }
    next.googleDriveRetentionDays = input.googleDriveRetentionDays
  }
  for (const field of ['cameraSettings'] as const) {
    if (input[field] === undefined) continue
    if (typeof input[field] !== 'string' || Buffer.byteLength(input[field], 'utf8') > MAX_REMOTE_CONFIG_FIELD_BYTES) throw new Error(`Data ${field} melewati batas 4 MB.`)
    try { JSON.parse(input[field]) } catch { throw new Error(`Format ${field} tidak valid.`) }
    next[field] = input[field]
  }
  if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_REMOTE_CONFIG_BYTES) throw new Error('Total konfigurasi booth melewati batas 4,1 MB.')
  return next
}

export async function ensureDeviceConfig(db: Db, deviceId: string, storeId: string): Promise<DeviceConfigDocument> {
  const settings = await ensureSettings(db)
  const defaults: RemoteBoothConfig = {
    storeName: settings.storeName,
    photoStripPrice: settings.photoStripPrice,
    singlePhotoPrice: settings.singlePhotoPrice,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    operationMode: settings.operationMode,
    paymentEnvironment: settings.paymentEnvironment,
    midtransClientKey: settings.midtransClientKey,
    googleDriveEnabled: 'false',
    googleDriveRetentionDays: '7',
    googleDriveFolder: 'Capturs',
    cameraSettings: JSON.stringify({ cameraDeviceId: '', cameraDeviceLabel: '', controls: {} }),
  }
  const collection = db.collection<DeviceConfigDocument>('device_configs')
  await collection.updateOne(
    { _id: deviceId },
    { $setOnInsert: { _id: deviceId, storeId, config: defaults, revision: 0, updatedAt: new Date() } },
    { upsert: true },
  )
  let document = await collection.findOne({ _id: deviceId, storeId })
  if (!document) throw new Error('Konfigurasi booth tidak ditemukan.')
  const cleanConfig = { ...document.config } as RemoteBoothConfig & {
    price?: string
    photoStripPrice?: string
    singlePhotoPrice?: string
    boothFrames?: string
    rcloneEnabled?: string
    rcloneRetentionDays?: string
    rcloneFolder?: string
    rcloneExecutable?: string
    rcloneRemote?: string
  }
  let configChanged = false
  const legacyPrice = Number(cleanConfig.price)
  const legacyStripPrice = Number.isSafeInteger(legacyPrice) && legacyPrice > 0 ? String(legacyPrice) : settings.photoStripPrice
  if (!/^\d{1,9}$/.test(String(cleanConfig.photoStripPrice ?? '')) || Number(cleanConfig.photoStripPrice) < 1) {
    cleanConfig.photoStripPrice = legacyStripPrice
    configChanged = true
  }
  if (!/^\d{1,9}$/.test(String(cleanConfig.singlePhotoPrice ?? '')) || Number(cleanConfig.singlePhotoPrice) < 1) {
    cleanConfig.singlePhotoPrice = Number.isSafeInteger(legacyPrice) && legacyPrice > 0
      ? String(Math.round(legacyPrice * 0.7))
      : settings.singlePhotoPrice
    configChanged = true
  }
  if (!/^([1-9]|[1-5]\d|60)$/.test(String(cleanConfig.sessionTimeoutMinutes ?? ''))) {
    cleanConfig.sessionTimeoutMinutes = settings.sessionTimeoutMinutes
    configChanged = true
  }
  if (cleanConfig.price !== undefined) {
    delete cleanConfig.price
    configChanged = true
  }
  const legacyDriveFields = {
    rcloneEnabled: 'googleDriveEnabled',
    rcloneRetentionDays: 'googleDriveRetentionDays',
    rcloneFolder: 'googleDriveFolder',
  } as const
  for (const [legacy, current] of Object.entries(legacyDriveFields) as [keyof typeof legacyDriveFields, typeof legacyDriveFields[keyof typeof legacyDriveFields]][]) {
    if (cleanConfig[current] === undefined && typeof cleanConfig[legacy] === 'string') cleanConfig[current] = cleanConfig[legacy] as never
    if (cleanConfig[legacy] !== undefined) {
      delete cleanConfig[legacy]
      configChanged = true
    }
  }
  for (const legacy of ['rcloneExecutable', 'rcloneRemote'] as const) {
    if (cleanConfig[legacy] !== undefined) {
      delete cleanConfig[legacy]
      configChanged = true
    }
  }
  if (typeof cleanConfig.boothFrames === 'string') {
    await migrateLegacyDeviceFrames(db, deviceId, storeId, cleanConfig.boothFrames)
    delete cleanConfig.boothFrames
    configChanged = true
  }
  if (!/^\d{1,4}$/.test(cleanConfig.googleDriveRetentionDays ?? '')
    || Number(cleanConfig.googleDriveRetentionDays) < 1 || Number(cleanConfig.googleDriveRetentionDays) > 3650) {
    cleanConfig.googleDriveRetentionDays = '7'
    configChanged = true
  }
  if (cleanConfig.googleDriveEnabled !== 'true' && cleanConfig.googleDriveEnabled !== 'false') {
    cleanConfig.googleDriveEnabled = 'false'
    configChanged = true
  }
  if (typeof cleanConfig.googleDriveFolder !== 'string' || !cleanConfig.googleDriveFolder.trim()) {
    cleanConfig.googleDriveFolder = 'Capturs'
    configChanged = true
  }
  if (configChanged) {
    const updatedAt = new Date()
    await collection.updateOne({ _id: deviceId, storeId }, { $set: { config: cleanConfig, revision: document.revision + 1, updatedAt } })
    document = { ...document, config: cleanConfig, revision: document.revision + 1, updatedAt }
  }
  return document
}

const emptyFrameManifest = (): DeviceFrameManifest => ({ activeFrameId: '', frames: [] })
const frameIdPattern = /^[a-zA-Z0-9_-]{1,100}$/
const maxFrameThumbnailBytes = 600_000

function sanitizeFrameManifest(input: unknown): DeviceFrameManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Manifest frame tidak valid.')
  const value = input as Record<string, unknown>
  if (!Array.isArray(value.frames) || value.frames.length > 500) throw new Error('Daftar frame tidak valid.')
  const frames = value.frames.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Metadata frame tidak valid.')
    const frame = entry as Record<string, unknown>
    const id = typeof frame.id === 'string' ? frame.id : ''
    const name = typeof frame.name === 'string' ? frame.name.trim() : ''
    if (!frameIdPattern.test(id) || !name || name.length > 120) throw new Error('ID atau nama frame tidak valid.')
    if (typeof frame.width !== 'number' || !Number.isSafeInteger(frame.width) || frame.width < 1 || frame.width > 30_000
      || typeof frame.height !== 'number' || !Number.isSafeInteger(frame.height) || frame.height < 1 || frame.height > 30_000) throw new Error(`Dimensi frame ${name} tidak valid.`)
    const appliesTo: RemoteFrame['appliesTo'] | null = frame.appliesTo === 'strip' || frame.appliesTo === 'single' || frame.appliesTo === 'both' ? frame.appliesTo : null
    if (!appliesTo || !Array.isArray(frame.slots) || frame.slots.length > 100) throw new Error(`Pengaturan frame ${name} tidak valid.`)
    const assetHash = typeof frame.assetHash === 'string' && /^[a-f\d]{64}$/i.test(frame.assetHash) ? frame.assetHash.toLowerCase() : ''
    const thumbnailDataUrl = typeof frame.thumbnailDataUrl === 'string' ? frame.thumbnailDataUrl : typeof frame.dataUrl === 'string' ? frame.dataUrl : ''
    if (thumbnailDataUrl && (!thumbnailDataUrl.startsWith('data:image/png;base64,') || Buffer.byteLength(thumbnailDataUrl) > maxFrameThumbnailBytes)) throw new Error(`Thumbnail frame ${name} terlalu besar atau bukan PNG.`)
    const slots = frame.slots.map((slot) => {
      if (!slot || typeof slot !== 'object' || Array.isArray(slot)) throw new Error(`Slot frame ${name} tidak valid.`)
      const item = slot as Record<string, unknown>
      if (typeof item.id !== 'string' || item.id.length > 100
        || !['x', 'y', 'width', 'height'].every((key) => typeof item[key] === 'number' && Number.isFinite(item[key]))) throw new Error(`Slot frame ${name} tidak valid.`)
      return item
    })
    if (!assetHash) throw new Error(`PNG frame ${name} belum tersimpan.`)
    return { id, name, width: frame.width, height: frame.height, appliesTo, slots, assetHash, thumbnailDataUrl, dataUrl: thumbnailDataUrl }
  })
  if (new Set(frames.map((frame) => frame.id)).size !== frames.length) throw new Error('ID frame tidak boleh duplikat.')
  const activeFrameId = typeof value.activeFrameId === 'string' && frames.some((frame) => frame.id === value.activeFrameId) ? value.activeFrameId : frames[0]?.id ?? ''
  const manifest = { activeFrameId, frames }
  if (Buffer.byteLength(JSON.stringify(manifest)) > 3_800_000) throw new Error('Manifest frame terlalu besar. Kurangi jumlah frame atau ukuran thumbnail.')
  return manifest
}

export async function ensureDeviceFrames(db: Db, deviceId: string, storeId: string) {
  const collection = db.collection<DeviceFrameManifestDocument>('device_frame_manifests')
  await collection.updateOne({ _id: deviceId, storeId }, { $setOnInsert: { _id: deviceId, storeId, manifest: emptyFrameManifest(), revision: 0, updatedAt: new Date() } }, { upsert: true })
  const document = await collection.findOne({ _id: deviceId, storeId })
  if (!document) throw new Error('Daftar frame booth tidak ditemukan.')
  return document
}

export async function getDeviceFrameManifestStatus(db: Db, deviceId: string, storeId: string) {
  const collection = db.collection<DeviceFrameManifestDocument>('device_frame_manifests')
  const status = await collection.findOne({ _id: deviceId, storeId }, { projection: { revision: 1, updatedAt: 1 } })
  if (status) return { revision: status.revision, updatedAt: status.updatedAt }
  const created = await ensureDeviceFrames(db, deviceId, storeId)
  return { revision: created.revision, updatedAt: created.updatedAt }
}

export async function saveDeviceFrames(db: Db, deviceId: string, storeId: string, input: unknown, expectedRevision?: number) {
  const current = await ensureDeviceFrames(db, deviceId, storeId)
  if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new Error('Daftar frame booth sudah berubah. Segarkan data sebelum menyimpan lagi.')
  const manifest = sanitizeFrameManifest(input)
  const assets = stringIdCollection(db, 'device_frame_assets')
  if (manifest.frames.length) {
    const hashes = new Set(manifest.frames.map((frame) => frame.assetHash))
    const assetIds = [...hashes].map((hash) => `${deviceId}:${hash}`)
    const storedAssets = await assets.find({ _id: { $in: assetIds }, storeId }).project<{ _id: string; sha256: string }>({ _id: 1, sha256: 1 }).toArray()
    const storedHashes = new Set(storedAssets.map((asset) => asset.sha256))
    const missing = manifest.frames.find((frame) => !storedHashes.has(frame.assetHash))
    if (missing) throw new Error(`File PNG frame ${missing.name} belum diunggah.`)
  }
  const updatedAt = new Date()
  const revision = current.revision + 1
  const result = await db.collection<DeviceFrameManifestDocument>('device_frame_manifests').updateOne(
    { _id: deviceId, storeId, revision: current.revision },
    { $set: { manifest, revision, updatedAt } },
  )
  if (result.matchedCount !== 1) throw new Error('Daftar frame booth sudah berubah. Segarkan data sebelum menyimpan lagi.')
  await assets.deleteMany({ deviceId, storeId, sha256: { $nin: [...new Set(manifest.frames.map((frame) => frame.assetHash))] } })
  return { _id: deviceId, storeId, manifest, revision, updatedAt }
}

export function frameChangeSummary(previous: DeviceFrameManifest, next: DeviceFrameManifest) {
  const previousFrames = new Map(previous.frames.map((frame) => [frame.id, frame]))
  const nextFrames = new Map(next.frames.map((frame) => [frame.id, frame]))
  const changes: string[] = []
  for (const [id, frame] of nextFrames) {
    const oldFrame = previousFrames.get(id)
    if (!oldFrame) {
      changes.push(`Frame ditambahkan: ${frame.name}`)
      continue
    }
    const fingerprint = (value: RemoteFrame) => stableJson({
      name: value.name,
      width: value.width,
      height: value.height,
      appliesTo: value.appliesTo,
      slots: value.slots,
      assetHash: value.assetHash,
    })
    if (fingerprint(oldFrame) !== fingerprint(frame)) changes.push(`Frame diedit: ${frame.name}`)
  }
  for (const [id, frame] of previousFrames) {
    if (!nextFrames.has(id)) changes.push(`Frame dihapus: ${frame.name}`)
  }
  if (!changes.length && previous.activeFrameId !== next.activeFrameId) {
    const active = nextFrames.get(next.activeFrameId)
    changes.push(`Frame aktif diganti${active ? `: ${active.name}` : ''}`)
  }
  return changes
}

export async function saveDeviceFrameAsset(db: Db, deviceId: string, storeId: string, frameId: string, dataUrl: unknown) {
  if (!frameIdPattern.test(frameId)) throw new Error('ID frame tidak valid.')
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('Gambar frame harus berupa PNG.')
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
  if (!bytes.length || Buffer.byteLength(JSON.stringify({ dataUrl })) > MAX_API_BODY_BYTES) throw new Error('PNG frame melewati batas unggah 4,49 MB setelah encoding.')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await stringIdCollection(db, 'device_frame_assets').updateOne(
    { _id: `${deviceId}:${sha256}` },
    { $set: { deviceId, storeId, sha256, dataUrl, updatedAt: new Date() } },
    { upsert: true },
  )
  return { sha256 }
}

export async function getDeviceFrameAssetBytes(db: Db, deviceId: string, storeId: string, frameId: string) {
  if (!frameIdPattern.test(frameId)) throw new Error('ID frame tidak valid.')
  const manifest = await ensureDeviceFrames(db, deviceId, storeId)
  const frame = manifest.manifest.frames.find((entry) => entry.id === frameId)
  const asset = frame
    ? await stringIdCollection(db, 'device_frame_assets').findOne({ _id: `${deviceId}:${frame.assetHash}`, storeId, sha256: frame.assetHash })
    : null
  if (!asset || !frame || asset.sha256 !== frame.assetHash) throw new Error('File PNG frame tidak ditemukan.')
  const bytes = Buffer.from(asset.dataUrl.slice('data:image/png;base64,'.length), 'base64')
  if (!bytes.length || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Hash PNG frame tidak cocok dengan manifest.')
  return { bytes, sha256: asset.sha256 }
}

export async function getDeviceFrameAsset(db: Db, deviceId: string, storeId: string, frameId: string) {
  const asset = await getDeviceFrameAssetBytes(db, deviceId, storeId, frameId)
  return { dataUrl: `data:image/png;base64,${asset.bytes.toString('base64')}`, sha256: asset.sha256 }
}

async function migrateLegacyDeviceFrames(db: Db, deviceId: string, storeId: string, raw: string) {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { parsed = emptyFrameManifest() }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Record<string, unknown>).frames)) return
  const frames: Record<string, unknown>[] = []
  for (const sourceValue of (parsed as { frames: unknown[] }).frames) {
    if (!sourceValue || typeof sourceValue !== 'object' || Array.isArray(sourceValue)) continue
    const source = { ...(sourceValue as Record<string, unknown>) }
    const id = typeof source.id === 'string' ? source.id : ''
    const dataUrl = typeof source.dataUrl === 'string' ? source.dataUrl : ''
    if (!frameIdPattern.test(id) || !dataUrl.startsWith('data:image/png;base64,')) continue
    const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')
    if (!bytes.length || Buffer.byteLength(JSON.stringify({ dataUrl })) > MAX_API_BODY_BYTES) continue
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await stringIdCollection(db, 'device_frame_assets').updateOne({ _id: `${deviceId}:${sha256}` }, { $set: { deviceId, storeId, sha256, dataUrl, updatedAt: new Date() } }, { upsert: true })
    source.assetHash = sha256
    source.thumbnailDataUrl = typeof source.thumbnailDataUrl === 'string' ? source.thumbnailDataUrl : ''
    source.dataUrl = source.thumbnailDataUrl
    frames.push(source)
  }
  const manifest = sanitizeFrameManifest({ activeFrameId: (parsed as { activeFrameId?: unknown }).activeFrameId, frames })
  const collection = db.collection<DeviceFrameManifestDocument>('device_frame_manifests')
  await collection.updateOne({ _id: deviceId, storeId }, { $set: { manifest, revision: 1, updatedAt: new Date() }, $setOnInsert: { _id: deviceId, storeId } }, { upsert: true })
}

export async function saveDeviceConfig(db: Db, deviceId: string, storeId: string, input: Record<string, unknown>, expectedRevision?: number) {
  const collection = db.collection<DeviceConfigDocument>('device_configs')
  const current = await ensureDeviceConfig(db, deviceId, storeId)
  if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new Error('Konfigurasi booth sudah berubah. Segarkan data sebelum menyimpan lagi.')
  const config = sanitizeRemoteConfig(input, current.config)
  const updatedAt = new Date()
  const result = await collection.updateOne(
    { _id: deviceId, storeId, revision: current.revision },
    { $set: { config, revision: current.revision + 1, updatedAt } },
  )
  if (result.matchedCount !== 1) throw new Error('Konfigurasi booth sudah berubah. Segarkan data sebelum menyimpan lagi.')
  return { _id: deviceId, storeId, config, revision: current.revision + 1, updatedAt }
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function sessionSecret() {
  return env('SESSION_SECRET')
}

function sign(value: string) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url')
}

export function issueAdminCookie(email: string) {
  const payload = Buffer.from(JSON.stringify({ sub: email, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString('base64url')
  const value = `${payload}.${sign(payload)}`
  return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

function cookieValue(req: VercelRequest) {
  const cookie = req.headers.cookie ?? ''
  return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1) ?? ''
}

export function adminIdentity(req: VercelRequest) {
  try {
    const [payload, signature, extra] = cookieValue(req).split('.')
    if (!payload || !signature || extra) return null
    if (!constantTimeEqual(sign(payload), signature)) return null
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: string; exp?: number }
    if (session.sub !== env('ADMIN_EMAIL') || !Number.isSafeInteger(session.exp) || Number(session.exp) <= Date.now() / 1000) return null
    return { email: session.sub }
  } catch {
    return null
  }
}

export function requireAdmin(req: VercelRequest, res: VercelResponse) {
  const identity = adminIdentity(req)
  if (!identity) {
    json(res, 401, { error: 'Sesi login sudah berakhir. Silakan masuk kembali.' })
    return null
  }
  return identity
}

export function checkAdminCredentials(email: string, password: string) {
  return constantTimeEqual(email.trim().toLowerCase(), env('ADMIN_EMAIL').toLowerCase())
    && constantTimeEqual(password, env('ADMIN_PASSWORD'))
}

export async function authenticateDevice(req: VercelRequest, res: VercelResponse) {
  const authorization = req.headers.authorization ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  const db = await database()
  let device: StringIdDocument | null = null
  let legacy = false
  if (token.length >= 24 && token.length <= 200) {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    device = await stringIdCollection(db, 'devices').findOne({ tokenHash })
    legacy = Boolean(device)
  }
  if (device?.revokedAt) {
    json(res, 401, { error: 'Koneksi booth sudah dicabut.' })
    return null
  }
  if (!device) {
    const deviceId = req.headers['x-booth-id'] ?? ''
    device = await stringIdCollection(db, 'devices').findOne({ _id: deviceId })
    if (!device || typeof device.publicKey !== 'string' || !device.approvedAt || device.revokedAt) {
      json(res, device?.revokedAt ? 401 : 403, { error: device?.revokedAt ? 'Koneksi booth sudah dicabut.' : 'Booth menunggu persetujuan Web Admin.' })
      return null
    }
    const proof = await consumeDeviceProof(db, req, String(device.publicKey), deviceId)
    if (proof !== 'accepted') {
      json(res, 401, { error: proof === 'replayed' ? 'Permintaan booth sudah pernah digunakan.' : 'Tanda tangan booth tidak valid atau sudah kedaluwarsa.' })
      return null
    }
  }
  const lastSeenAt = new Date()
  await stringIdCollection(db, 'devices').updateOne(
    { _id: device._id },
    legacy
      ? { $max: { lastSeenAt } }
      : { $max: { lastSeenAt, lastSignatureAt: lastSeenAt } },
  )
  return { db, device }
}

export async function enrollDevice(db: Db, input: Record<string, unknown>, storeId: string) {
  const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : ''
  if (!/^[a-f\d-]{36}$/i.test(deviceId)) throw new Error('ID booth tidak valid.')
  const publicKey = validateDevicePublicKey(input.publicKey)
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : `Booth ${deviceId.slice(0, 8)}`
  const devices = stringIdCollection(db, 'devices')
  const existing = await devices.findOne({ _id: deviceId })
  if (existing) {
    if (existing.publicKey !== publicKey || existing.storeId !== storeId) throw new Error('ID booth sudah terdaftar dengan identitas berbeda.')
    const lastSeenAt = new Date()
    await devices.updateOne(
      { _id: deviceId },
      { $max: { lastSeenAt, lastSignatureAt: lastSeenAt } },
    )
    return { deviceId, status: existing.revokedAt ? 'revoked' : existing.approvedAt ? 'approved' : 'pending' }
  }
  const createdAt = new Date()
  await devices.insertOne({
    _id: deviceId,
    storeId,
    name,
    publicKey,
    tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    createdAt,
    lastSeenAt: createdAt,
    enrollmentType: 'device-signature',
  })
  return { deviceId, status: 'pending' }
}

export function issueDeviceToken() {
  return randomBytes(32).toString('base64url')
}

export function clearAdminCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}
