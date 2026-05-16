const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipboardAPI', {
  getAll: () => ipcRenderer.invoke('clipboard:get-all'),
  search: (keyword) => ipcRenderer.invoke('clipboard:search', keyword),
  pin: (id) => ipcRenderer.invoke('clipboard:pin', id),
  delete: (id) => ipcRenderer.invoke('clipboard:delete', id),
  paste: (id) => ipcRenderer.invoke('clipboard:paste', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  onNewItem: (callback) => ipcRenderer.on('clipboard:new-item', (_, item) => callback(item))
});
