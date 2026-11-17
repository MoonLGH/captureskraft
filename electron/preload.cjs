const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('boothConfig', {
  load: () => ipcRenderer.invoke('config:load'),
  save: (config) => ipcRenderer.invoke('config:save', config),
})
