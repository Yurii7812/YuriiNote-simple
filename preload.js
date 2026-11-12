'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', Object.freeze({
  load: () => ipcRenderer.invoke('data:load'),
  save: data => ipcRenderer.invoke('data:save', data),
  openFolder: () => ipcRenderer.invoke('data:open-folder'),
  onCloseRequest: callback => ipcRenderer.on('save-before-close', () => callback()),
  closeReady: success => ipcRenderer.send('data:close-ready', Boolean(success))
}));
