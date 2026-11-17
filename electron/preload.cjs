const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('boothConfig', {
  load: () => ipcRenderer.invoke('config:load'),
  save: (config) => ipcRenderer.invoke('config:save', config),
  saveSession: (files, metadata) => ipcRenderer.invoke('session:save', { files, metadata }),
  chooseStoragePath: () => ipcRenderer.invoke('storage:choose-path'),
  createMidtransPayment: (input) => ipcRenderer.invoke('payment:create-midtrans', input),
  verifyMidtransPayment: (orderId) => ipcRenderer.invoke('payment:verify-midtrans', orderId),
  testRclone: (settings) => ipcRenderer.invoke('rclone:test', settings),
})
