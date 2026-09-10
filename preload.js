const { contextBridge, ipcRenderer, webUtils } = require('electron');
const listen = (channel, callback) => {
  const fn = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};
const api = {
  getFilePath: file => webUtils.getPathForFile(file),
  beginWindowDrag: () => ipcRenderer.send('begin-window-drag'),
  endWindowDrag: () => ipcRenderer.send('end-window-drag'),
  resizeWindow: payload => ipcRenderer.send('resize-window', payload)
};
const invokes = {
  getConfig: 'get-config', saveConfig: 'save-config', resetSettings: 'reset-settings',
  listModels: 'list-models', importModel: 'import-model', pickModel: 'pick-model', addBundledModel: 'add-bundled-model',
  selectModel: 'select-model', removeModel: 'remove-model', rescanModel: 'rescan-model', reloadModel: 'reload-model',
  modelDescriptor: 'model-descriptor', openLibraryFolder: 'open-library-folder', playAction: 'play-action', stopAction: 'stop-action',
  reportMotion: 'motion-status', reportAnchor: 'model-anchor', showBubble: 'show-bubble', hideBubble: 'hide-bubble',
  bridgeRead: 'bridge-read', openChatGPT: 'open-chatgpt', openSettings: 'open-settings',
  beginWindowResize: 'begin-window-resize', endWindowResize: 'end-window-resize', closeSettings: 'close-settings',
  hideAssistant: 'hide-assistant', showAssistant: 'show-assistant', quitAssistant: 'quit-assistant'
};
const events = { onConfigUpdated: 'config-updated', onLibraryUpdated: 'library-updated', onReloadModel: 'reload-model',
  onPlayAction: 'play-action', onStopAction: 'stop-action', onMotionStatus: 'motion-status', onBubbleOpen: 'bubble-open', onResizeMode: 'resize-mode' };
for (const [name, channel] of Object.entries(invokes)) api[name] = (...args) => ipcRenderer.invoke(channel, ...args);
for (const [name, channel] of Object.entries(events)) api[name] = cb => listen(channel, cb);
contextBridge.exposeInMainWorld('desktopAPI', Object.freeze(api));
