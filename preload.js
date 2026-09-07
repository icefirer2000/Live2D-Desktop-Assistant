const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getDefaultModelPath: () => ipcRenderer.invoke('get-default-model-path'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getFilePath: (file) => webUtils.getPathForFile(file),
  loadLive2DModel: (modelPath) => ipcRenderer.invoke('load-live2d-model', modelPath),
  onConfigUpdated: (callback) => ipcRenderer.on('config-updated', (_event, config) => callback(config)),
  openChatGPT: () => ipcRenderer.invoke('open-chatgpt'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  beginWindowDrag: () => ipcRenderer.send('begin-window-drag'),
  endWindowDrag: () => ipcRenderer.send('end-window-drag'),
  resizeWindow: (payload) => ipcRenderer.send('resize-window', payload),
  endWindowResize: () => ipcRenderer.send('end-window-resize'),
  beginWindowResize: (edge) => ipcRenderer.invoke('begin-window-resize', edge),
  endWindowResize: () => ipcRenderer.invoke('end-window-resize'),
  onResizeMode: (callback) => ipcRenderer.on('resize-mode', (_event, enabled) => callback(Boolean(enabled))),
  closeSettings: () => ipcRenderer.invoke('close-settings'),
  hideAssistant: () => ipcRenderer.invoke('hide-assistant'),
  quitAssistant: () => ipcRenderer.invoke('quit-assistant')
});
