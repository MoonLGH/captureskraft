const { app, BrowserWindow, ipcMain, safeStorage, session } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const secretFields = ['mongoUri', 'ftpPassword']
const allowedFields = [
  'storeName', 'storeId', 'price', 'mongoUri', 'ftpHost', 'ftpPort',
  'ftpUser', 'ftpPassword', 'syncUrl',
  'cameraSettings',
  'boothFrames',
]

function isTrustedRenderer(event) {
  const url = event.senderFrame?.url ?? ''
  return url.startsWith('file://') || url.startsWith('http://127.0.0.1:5173/')
}

function configPath() {
  return path.join(app.getPath('userData'), 'store-config.json')
}

async function loadConfig(event) {
  if (!isTrustedRenderer(event)) throw new Error('Akses konfigurasi ditolak.')
  try {
    const saved = JSON.parse(await fs.readFile(configPath(), 'utf8'))
    const config = { ...saved.public }
    if (saved.secrets && await safeStorage.isAsyncEncryptionAvailable()) {
      for (const field of secretFields) {
        const encrypted = saved.secrets[field]
        if (encrypted) config[field] = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
      }
    }
    return config
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

async function saveConfig(event, input) {
  if (!isTrustedRenderer(event)) throw new Error('Akses konfigurasi ditolak.')
  const config = Object.fromEntries(allowedFields.map((field) => [field, String(input?.[field] ?? '')]))
  const encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable()
  if (!encryptionAvailable && secretFields.some((field) => config[field])) {
    throw new Error('Penyimpanan terenkripsi dari sistem operasi tidak tersedia.')
  }
  const publicConfig = { ...config }
  const secrets = {}
  for (const field of secretFields) {
    delete publicConfig[field]
    secrets[field] = config[field]
      ? (await safeStorage.encryptStringAsync(config[field])).toString('base64')
      : ''
  }
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify({ public: publicConfig, secrets }, null, 2), 'utf8')
  return { saved: true }
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

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const videoOnly = permission === 'media'
      && details.mediaTypes?.includes('video')
      && !details.mediaTypes?.includes('audio')
    callback(Boolean(videoOnly))
  })
  ipcMain.handle('config:load', loadConfig)
  ipcMain.handle('config:save', saveConfig)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
