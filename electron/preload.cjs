const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('boothConfig', {
  load: () => ipcRenderer.invoke('config:load'),
  getRevision: () => ipcRenderer.invoke('config:revision'),
  save: (config, frameAssets) => ipcRenderer.invoke('config:save', config, frameAssets),
  onTelegramChatId: (callback) => {
    const listener = (_event, chatId) => callback(chatId)
    ipcRenderer.on('telegram:chat-id', listener)
    return () => ipcRenderer.removeListener('telegram:chat-id', listener)
  },
  loadFrameAsset: (frameId) => ipcRenderer.invoke('frame:load', frameId),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  testPrinter: (settings) => ipcRenderer.invoke('printer:test', settings),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  checkCloudUpdates: () => ipcRenderer.invoke('sync:check-updates'),
  setSyncApplyAllowed: (allowed) => ipcRenderer.invoke('sync:apply-allowed', allowed),
  setFrameSyncApplyAllowed: (allowed) => ipcRenderer.invoke('sync:frame-apply-allowed', allowed),
  setCloudApplyAllowed: (configAllowed, frameAllowed) => ipcRenderer.invoke('sync:apply-allowed-both', configAllowed, frameAllowed),
  setSessionActive: (active) => ipcRenderer.invoke('session:set-active', active),
  syncForMaintenance: () => ipcRenderer.invoke('sync:maintenance'),
  restartAfterMaintenance: () => ipcRenderer.invoke('app:restart-after-maintenance'),
  saveSession: (files, metadata) => ipcRenderer.invoke('session:save', { files, metadata }),
  notifyAbandonedSession: (metadata) => ipcRenderer.invoke('session:abandoned', metadata),
  onDriveUploadStatus: (callback) => {
    const listener = (_event, update) => callback(update)
    ipcRenderer.on('session:drive-upload-status', listener)
    return () => ipcRenderer.removeListener('session:drive-upload-status', listener)
  },
  chooseStoragePath: () => ipcRenderer.invoke('storage:choose-path'),
  createMidtransPayment: (input) => ipcRenderer.invoke('payment:create-midtrans', input),
  verifyMidtransPayment: (orderId) => ipcRenderer.invoke('payment:verify-midtrans', orderId),
  testGoogleDrive: () => ipcRenderer.invoke('google-drive:test'),
  connectGoogleDrive: (credentials) => ipcRenderer.invoke('google-drive:connect', credentials),
})
