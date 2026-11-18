const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('doctorgame', {
  platform: process.platform,
  sources: () => ipcRenderer.invoke('capture:sources'),
  selectSource: id => ipcRenderer.invoke('capture:select', id),
  begin: metadata => ipcRenderer.invoke('recording:begin', metadata),
  append: (id, bytes) => ipcRenderer.invoke('recording:append', id, bytes),
  finish: (id, metadata) => ipcRenderer.invoke('recording:finish', id, metadata),
  list: () => ipcRenderer.invoke('recording:list'),
  openFolder: () => ipcRenderer.invoke('recording:folder'),
  setBusy: state => ipcRenderer.invoke('app:busy', state),
  onStop: callback => {
    const listener = () => callback();
    ipcRenderer.on('capture:stop', listener);
    return () => ipcRenderer.removeListener('capture:stop', listener);
  }
});
