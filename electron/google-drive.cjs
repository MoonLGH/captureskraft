const http = require('node:http')
const { Readable } = require('node:stream')
const { randomBytes } = require('node:crypto')
const { google } = require('googleapis')

const driveScope = 'https://www.googleapis.com/auth/drive.file'
const userInfoScopes = ['openid', 'email']
const folderMimeType = 'application/vnd.google-apps.folder'

function validOAuthClient(clientId) {
  if (typeof clientId !== 'string' || !clientId.trim().endsWith('.apps.googleusercontent.com')) {
    throw new Error('Google OAuth Client ID belum valid. Gunakan kredensial aplikasi Desktop dari Google Cloud.')
  }
}

function oauthErrorMessage(error) {
  const details = error?.response?.data
  if (details && typeof details === 'object') {
    const errorCode = typeof details.error === 'string' ? details.error : ''
    const description = typeof details.error_description === 'string' ? details.error_description : ''
    if (errorCode || description) return [errorCode, description].filter(Boolean).join(': ')
  }
  return error instanceof Error ? error.message : 'Respons OAuth Google tidak valid.'
}

function waitForAuthorizationCode(server, expectedState, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(new Error('Login Google Drive melewati batas waktu. Coba hubungkan akun lagi.')), timeoutMs)
    const finish = (error, code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.removeListener('request', onRequest)
      server.removeListener('close', onClose)
      if (error) reject(error)
      else resolve(code)
    }
    const onClose = () => finish(new Error('Login Google Drive dihentikan. Coba hubungkan akun lagi.'))
    const onRequest = (request, response) => {
      let url
      try {
        url = new URL(request.url || '/', 'http://127.0.0.1')
      } catch {
        response.writeHead(400).end('Permintaan OAuth tidak valid.')
        return
      }
      if (url.pathname !== '/') {
        response.writeHead(404).end('Halaman tidak ditemukan.')
        return
      }
      if (url.searchParams.get('state') !== expectedState) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Verifikasi login gagal. Kembali ke aplikasi dan coba lagi.')
        finish(new Error('Verifikasi keamanan login Google gagal. Coba hubungkan akun lagi.'))
        return
      }
      const oauthError = url.searchParams.get('error')
      if (oauthError) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Google Drive</title><p>Login dibatalkan. Kamu bisa menutup halaman ini.</p>')
        finish(new Error('Login Google Drive dibatalkan atau ditolak.'))
        return
      }
      const code = url.searchParams.get('code')
      if (!code) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Kode login tidak ditemukan.')
        finish(new Error('Google tidak mengirim kode login. Coba hubungkan akun lagi.'))
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html><meta charset="utf-8"><title>Login Google diterima</title><body style="font:16px system-ui;padding:48px;color:#253"><h2>Login Google diterima</h2><p>Kembali ke Capturs untuk menyelesaikan koneksi. Halaman ini boleh ditutup.</p></body></html>')
      finish(null, code)
    }
    server.on('request', onRequest)
    server.on('close', onClose)
  })
}

async function authorizeGoogleDrive({ clientId, clientSecret, openExternal }) {
  validOAuthClient(clientId)
  if (typeof openExternal !== 'function') throw new Error('Browser sistem tidak tersedia untuk login Google.')

  const server = http.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Port login lokal Google tidak berhasil disiapkan.')
  }
  const redirectUri = `http://127.0.0.1:${address.port}`
  const oauth2 = new google.auth.OAuth2({
    clientId,
    clientSecret: clientSecret || undefined,
    redirectUri,
    clientAuthentication: clientSecret ? 'ClientSecretPost' : 'None',
  })
  let authorizationCode
  try {
    const { codeVerifier, codeChallenge } = await oauth2.generateCodeVerifierAsync()
    const state = randomBytes(32).toString('base64url')
    const authorizationUrl = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent select_account',
      scope: [driveScope, ...userInfoScopes],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    authorizationCode = waitForAuthorizationCode(server, state)
    await openExternal(authorizationUrl)
    const code = await authorizationCode
    let tokens
    try {
      ({ tokens } = await oauth2.getToken({ code, codeVerifier, redirect_uri: redirectUri }))
    } catch (error) {
      throw new Error(`Pertukaran kode OAuth Google gagal: ${oauthErrorMessage(error)}`)
    }
    oauth2.setCredentials(tokens)
    let userInfo
    try {
      userInfo = await google.oauth2({ version: 'v2', auth: oauth2, timeout: 30_000 }).userinfo.get()
    } catch (error) {
      throw new Error(`Verifikasi akun Google gagal: ${oauthErrorMessage(error)}`)
    }
    const email = userInfo.data.email?.trim().toLowerCase()
    if (!email) throw new Error('Google tidak mengembalikan email akun. Pastikan izin email disetujui lalu coba lagi.')
    return { email, refreshToken: tokens.refresh_token || '' }
  } catch (error) {
    if (server.listening) server.close()
    await authorizationCode?.catch(() => {})
    throw error
  } finally {
    if (server.listening) server.close()
  }
}

function createGoogleDriveClient(account) {
  validOAuthClient(account?.clientId)
  if (typeof account?.refreshToken !== 'string' || !account.refreshToken) {
    throw new Error('Akun Google Drive belum terhubung. Hubungkan akun Google dari Admin > Koneksi data.')
  }
  const auth = new google.auth.OAuth2({
    clientId: account.clientId,
    clientSecret: account.clientSecret || undefined,
    clientAuthentication: account.clientSecret ? 'ClientSecretPost' : 'None',
  })
  auth.setCredentials({ refresh_token: account.refreshToken })
  return {
    auth,
    drive: google.drive({ version: 'v3', auth, timeout: 300_000 }),
    userInfo: google.oauth2({ version: 'v2', auth, timeout: 30_000 }).userinfo,
  }
}

async function getGoogleDriveAccountEmail(account) {
  const client = createGoogleDriveClient(account)
  const response = await client.userInfo.get()
  const email = response.data.email?.trim().toLowerCase()
  if (!email) throw new Error('Email akun Google Drive tidak tersedia.')
  return email
}

function escapeDriveQuery(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function findOrCreateFolder(drive, name, parentId) {
  const escapedName = escapeDriveQuery(name)
  const response = await drive.files.list({
    q: `name = '${escapedName}' and mimeType = '${folderMimeType}' and '${parentId}' in parents and trashed = false`,
    spaces: 'drive',
    pageSize: 100,
    fields: 'files(id,name,mimeType)',
  })
  const existing = response.data.files?.find((file) => file.id && file.mimeType === folderMimeType)
  if (existing?.id) return existing.id
  const created = await drive.files.create({
    requestBody: { name, mimeType: folderMimeType, parents: [parentId] },
    fields: 'id',
  })
  if (!created.data.id) throw new Error(`Folder Google Drive "${name}" gagal dibuat.`)
  return created.data.id
}

function normalizeFolderSegments(folderPath) {
  if (typeof folderPath !== 'string' || !folderPath.trim() || folderPath.length > 500 || folderPath.includes(':')) {
    throw new Error('Nama folder Google Drive tidak valid.')
  }
  const segments = folderPath.trim().replace(/\\/g, '/').split('/')
  if (segments.some((part) => !part.trim() || part === '.' || part === '..' || part.trim().length > 100)) {
    throw new Error('Path folder Google Drive tidak valid.')
  }
  return segments.map((part) => part.trim())
}

async function ensureDestinationFolder(drive, folderPath) {
  let parentId = 'root'
  for (const segment of normalizeFolderSegments(folderPath)) {
    parentId = await findOrCreateFolder(drive, segment, parentId)
  }
  return parentId
}

async function createSessionFolder(account, folderPath, sessionId) {
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:-\d{2,})?$/.test(sessionId)) {
    throw new Error('ID sesi Drive tidak valid.')
  }
  const { drive } = createGoogleDriveClient(account)
  const parentId = await ensureDestinationFolder(drive, folderPath)
  const response = await drive.files.create({
    requestBody: { name: sessionId, mimeType: folderMimeType, parents: [parentId] },
    fields: 'id',
  })
  if (!response.data.id) throw new Error('Folder sesi Google Drive gagal dibuat.')
  return response.data.id
}

async function uploadSessionFiles(account, folderId, files) {
  const { drive } = createGoogleDriveClient(account)
  for (const file of files) {
    const mimeType = file.name.endsWith('.png') ? 'image/png' : file.name.endsWith('.mp4') ? 'video/mp4' : 'image/gif'
    await drive.files.create({
      requestBody: { name: file.name, parents: [folderId] },
      media: { mimeType, body: Readable.from([file.bytes]) },
      uploadType: 'resumable',
      fields: 'id',
    })
  }
}

async function shareSessionFolder(account, folderId) {
  const { drive } = createGoogleDriveClient(account)
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { type: 'anyone', role: 'reader' },
    fields: 'id',
  })
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`
}

async function deleteSessionFolder(account, folderId) {
  if (typeof folderId !== 'string' || !/^[a-zA-Z0-9_-]{5,200}$/.test(folderId)) {
    throw new Error('ID folder sesi Google Drive tidak valid.')
  }
  const { drive } = createGoogleDriveClient(account)
  await drive.files.delete({ fileId: folderId })
}

module.exports = {
  authorizeGoogleDrive,
  createGoogleDriveClient,
  createSessionFolder,
  deleteSessionFolder,
  getGoogleDriveAccountEmail,
  shareSessionFolder,
  uploadSessionFiles,
}
