const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('boothConfig', {
  load: () => ipcRenderer.invoke('config:load'),
  getRevision: () => ipcRenderer.invoke('config:revision'),
  save: (config) => ipcRenderer.invoke('config:save', config),
  saveSession: (files, metadata) => ipcRenderer.invoke('session:save', { files, metadata }),
  chooseStoragePath: () => ipcRenderer.invoke('storage:choose-path'),
  createMidtransPayment: (input) => ipcRenderer.invoke('payment:create-midtrans', input),
  verifyMidtransPayment: (orderId) => ipcRenderer.invoke('payment:verify-midtrans', orderId),
  testRclone: (settings) => ipcRenderer.invoke('rclone:test', settings),
  connectRclone: (settings) => ipcRenderer.invoke('rclone:connect', settings),
})
