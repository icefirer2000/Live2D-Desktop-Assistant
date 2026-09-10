const { app, BrowserWindow, ipcMain, shell, screen, protocol, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { SettingsStore, defaults } = require('./src/settings-store');
const { ModelManager } = require('./src/model-manager');
const actionCatalog = require('./src/action-catalog');
const { responsiveScale } = require('./src/responsive-scale');
const { clampBounds, bubbleBounds } = require('./src/layout-manager');
if (process.env.LDA_TEST_PROFILE) app.setPath('userData', path.resolve(process.env.LDA_TEST_PROFILE));
let settingsStore, modelManager, bubbleWindow;
let modelAnchor = null, arrangingBubble = false;
let motionStatus = { ok: true, message: '尚未播放动作' };

// Keep WebGL available on machines where Chromium blocks the GPU; Live2D needs a WebGL context.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'live2d',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
]);

let mainWindow;
let settingsWindow;
const nativeDragSessions = new Map();
const pendingWindowSizes = new Map();
const windowSizeTimers = new Map();
const windowResizeSessions = new Map();
let nativeWindowSizeTimer = null;
const MAIN_WINDOW_SIZE = Object.freeze({ width: 460, height: 640 });
const MAIN_WINDOW_LIMITS = Object.freeze({ minWidth: 320, minHeight: 420 });
const SETTINGS_WINDOW_SIZE = Object.freeze({ width: 1100, height: 760 });
const RESPONSIVE_BASE_DISPLAY = Object.freeze({ width: 1920, height: 1080 });
const RESPONSIVE_SCALE_LIMITS = Object.freeze({ min: 0.72, max: 1.35 });
let mainWindowResponsiveScale = 1;
let settingsWindowResponsiveScale = 1;
let responsiveScaleTimer = null;

const getResponsiveScale = responsiveScale;

function scaleWindowSize(size, scale, fallback) {
  const normalized = fallback ? { ...fallback } : normalizeWindowSize(size);
  const factor = Number.isFinite(Number(scale)) ? Number(scale) : 1;
  return {
    width: Math.round(normalized.width * factor),
    height: Math.round(normalized.height * factor)
  };
}

function getDisplayForWindow(win) {
  if (!win || win.isDestroyed()) return screen.getPrimaryDisplay();
  return screen.getDisplayMatching(win.getBounds());
}

function getWindowResponsiveScale(win) {
  if (win === mainWindow) return mainWindowResponsiveScale || 1;
  if (win === settingsWindow) return settingsWindowResponsiveScale || 1;
  if (win === bubbleWindow) return getResponsiveScale(getDisplayForWindow(mainWindow));
  return 1;
}

function applyWebContentsScale(win, scale) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  try { win.webContents.setZoomFactor(scale); } catch { /* page may still be initializing */ }
}

function scheduleResponsiveScaleUpdate() {
  if (responsiveScaleTimer) return;
  responsiveScaleTimer = setImmediate(() => {
    responsiveScaleTimer = null;
    applyMainWindowResponsiveScale();
    applySettingsWindowResponsiveScale();
    placeBubble();
  });
}

function applyMainWindowResponsiveScale(force = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const nextScale = getResponsiveScale(getDisplayForWindow(mainWindow));
  const previousScale = mainWindowResponsiveScale || 1;
  mainWindowResponsiveScale = nextScale;
  applyWebContentsScale(mainWindow, nextScale);
  mainWindow.setMinimumSize(Math.round(320 * nextScale), Math.round(420 * nextScale));
  if (!force && Math.abs(nextScale - previousScale) < 0.001) {
    const bounds = mainWindow.getBounds(), safe = clampBounds(bounds, getDisplayForWindow(mainWindow).workArea);
    if (Object.keys(safe).some(k => safe[k] !== bounds[k])) mainWindow.setBounds(safe, false);
    return;
  }
  const config = readConfig();
  const nextSize = scaleWindowSize(config.windowSize, nextScale);
  const [width, height] = mainWindow.getSize();
  if (Math.abs(width - nextSize.width) > 1 || Math.abs(height - nextSize.height) > 1) {
    mainWindow.setBounds(clampBounds({ ...mainWindow.getBounds(), ...nextSize }, getDisplayForWindow(mainWindow).workArea), false);
  }
}

function applySettingsWindowResponsiveScale(force = false) {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  const nextScale = getResponsiveScale(getDisplayForWindow(settingsWindow));
  const previousScale = settingsWindowResponsiveScale || 1;
  settingsWindowResponsiveScale = nextScale;
  applyWebContentsScale(settingsWindow, nextScale);
  if (!force && Math.abs(nextScale - previousScale) < 0.001) return;
  const nextSize = scaleWindowSize(SETTINGS_WINDOW_SIZE, nextScale, SETTINGS_WINDOW_SIZE);
  const [width, height] = settingsWindow.getSize();
  if (Math.abs(width - nextSize.width) > 1 || Math.abs(height - nextSize.height) > 1) {
    settingsWindow.setSize(nextSize.width, nextSize.height, false);
  }
}

function normalizeWindowSize(size) {
  return {
    width: Math.round(Math.max(MAIN_WINDOW_LIMITS.minWidth, clampNumber(size?.width, MAIN_WINDOW_SIZE.width))),
    height: Math.round(Math.max(MAIN_WINDOW_LIMITS.minHeight, clampNumber(size?.height, MAIN_WINDOW_SIZE.height)))
  };
}

function normalizeBubbleSize(size) {
  return {
    width: Math.round(clampNumber(size?.width, 422, 300, 720)),
    height: Math.round(clampNumber(size?.height, 365, 280, 640))
  };
}

function clampNumber(value, fallback, min = -Infinity, max = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function applyWindowPresentation(config = readConfig()) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const alwaysOnTop = config?.alwaysOnTop !== false;
  const opacity = clampNumber(config?.opacity, 1, 0.35, 1);
  // Reapply both native properties after every settings update. Chromium can
  // recreate the transparent surface during Live2D/WebGL initialization, so
  // applying them only in the BrowserWindow constructor is not sufficient.
  mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating');
  mainWindow.setOpacity(opacity);
  mainWindow.setResizable(!config.layoutLocked);
  mainWindow.setMovable(!config.layoutLocked);
  bubbleWindow?.setAlwaysOnTop(alwaysOnTop, 'floating');
  bubbleWindow?.setMovable(!config.layoutLocked);
}

function persistNativeWindowSize() {
  if (nativeWindowSizeTimer) return;
  nativeWindowSizeTimer = setTimeout(() => {
    nativeWindowSizeTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [width, height] = mainWindow.getSize();
    const scale = getWindowResponsiveScale(mainWindow);
    const saved = writeConfig({
      ...readConfig(),
      // Persist the design-space size so restarting on another display does
      // not apply the current display scale a second time.
      windowSize: { width: width / scale, height: height / scale }
    });
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('config-updated', saved);
    }
  }, 120);
}

function updateNativeWindowDrag(windowId) {
  const session = nativeDragSessions.get(windowId);
  if (readConfig().layoutLocked) return false;
  const win = BrowserWindow.fromId(windowId);
  if (!session || !win || win.isDestroyed()) return false;
  try {
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - session.cursorX;
    const dy = cursor.y - session.cursorY;
    // Match the native drag threshold so a click never causes a one-pixel jump.
    if (Math.hypot(dx, dy) < 3) return true;
    const x = Math.round(session.windowX + dx);
    const y = Math.round(session.windowY + dy);
    if (x === session.lastX && y === session.lastY) return true;
    session.lastX = x;
    session.lastY = y;
    const bounded = clampBounds({ ...win.getBounds(), x, y }, screen.getDisplayNearestPoint(cursor).workArea);
    win.setPosition(bounded.x, bounded.y, false);
    return true;
  } catch {
    return false;
  }
}

function endNativeWindowDrag(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const session = nativeDragSessions.get(win.id);
  if (!session) return;
  updateNativeWindowDrag(win.id);
  clearInterval(session.timer);
  nativeDragSessions.delete(win.id);
  if (win === mainWindow) { const [x, y] = win.getPosition(); writeConfig({ windowPosition: { x, y } }); }
  if (win === bubbleWindow) saveBubbleOffset();
}

function beginNativeWindowDrag(event) {
  if (!trusted(event) || readConfig().layoutLocked) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const previous = nativeDragSessions.get(win.id);
  if (previous) clearInterval(previous.timer);
  const cursor = screen.getCursorScreenPoint();
  const [windowX, windowY] = win.getPosition();
  const session = { windowX, windowY, cursorX: cursor.x, cursorY: cursor.y, lastX: windowX, lastY: windowY, timer: null };
  session.timer = setInterval(() => updateNativeWindowDrag(win.id), 8);
  nativeDragSessions.set(win.id, session);
}

function flushWindowResize(windowId) {
  const timer = windowSizeTimers.get(windowId);
  if (timer) clearImmediate(timer);
  windowSizeTimers.delete(windowId);
  const pending = pendingWindowSizes.get(windowId);
  pendingWindowSizes.delete(windowId);
  const win = BrowserWindow.fromId(windowId);
  if (!pending || !win || win.isDestroyed()) return false;
  const session = windowResizeSessions.get(windowId);
  if (!session || !Number.isFinite(pending.cursorX) || !Number.isFinite(pending.cursorY)) {
    const scale = getWindowResponsiveScale(win);
    const size = normalizeWindowSize({
      width: Number(pending.width) / scale,
      height: Number(pending.height) / scale
    });
    const scaled = scaleWindowSize(size, scale);
    win.setSize(scaled.width, scaled.height, false);
    return true;
  }
  const dx = pending.cursorX - session.cursorX;
  const dy = pending.cursorY - session.cursorY;
  if (win === bubbleWindow) {
    const scale = getWindowResponsiveScale(win), area = getDisplayForWindow(win).workArea;
    const bounds = clampBounds({ ...win.getBounds(), width: Math.max(300 * scale, session.width + dx), height: Math.max(280 * scale, session.height + dy) }, area);
    arrangingBubble = true; win.setBounds(bounds, false); arrangingBubble = false; return true;
  }
  const growsLeft = session.edge.includes('w');
  const growsTop = session.edge.includes('n');
  const scale = getWindowResponsiveScale(win);
  const minWidth = Math.round(MAIN_WINDOW_LIMITS.minWidth * scale);
  const minHeight = Math.round(MAIN_WINDOW_LIMITS.minHeight * scale);
  const width = Math.max(minWidth, Math.round(session.width + (growsLeft ? -dx : session.edge.includes('e') ? dx : 0)));
  const height = Math.max(minHeight, Math.round(session.height + (growsTop ? -dy : session.edge.includes('s') ? dy : 0)));
  const x = Math.round(session.windowX + (growsLeft ? session.width - width : 0));
  const y = Math.round(session.windowY + (growsTop ? session.height - height : 0));
  win.setBounds(clampBounds({ x, y, width, height }, getDisplayForWindow(win).workArea), false);
  return true;
}

function queueWindowResize(event, size) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (readConfig().layoutLocked === true) return;
  const session = windowResizeSessions.get(win.id);
  pendingWindowSizes.set(win.id, session ? {
    cursorX: Number(size?.cursorX),
    cursorY: Number(size?.cursorY)
  } : normalizeWindowSize(size));
  if (!windowSizeTimers.has(win.id)) {
    windowSizeTimers.set(win.id, setImmediate(() => flushWindowResize(win.id)));
  }
}

function beginWindowResize(event, edge) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  if (readConfig().layoutLocked === true) return false;
  if (!edge) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
      mainWindow.webContents.send('resize-mode', true);
    }
    return true;
  }
  const cursor = screen.getCursorScreenPoint();
  const [windowX, windowY] = win.getPosition();
  const [width, height] = win.getSize();
  windowResizeSessions.set(win.id, { edge: String(edge), cursorX: cursor.x, cursorY: cursor.y, windowX, windowY, width, height });
  return true;
}

function endWindowResize(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  flushWindowResize(win.id);
  windowResizeSessions.delete(win.id);
  if (win === bubbleWindow) { const b = win.getBounds(), scale = getWindowResponsiveScale(win); broadcast(writeConfig({ bubbleSize: { width: b.width / scale, height: b.height / scale } })); saveBubbleOffset(); }
  win.webContents.send('resize-mode', false);
  return true;
}

function readConfig() { return settingsStore.read(); }
function writeConfig(patch) { return settingsStore.save(patch); }
function defaultConfig() { return defaults(); }
function createWindow() {
  const display = screen.getPrimaryDisplay();
  const bounds = display.workArea;
  const config = readConfig();
  mainWindowResponsiveScale = getResponsiveScale(display);
  const windowSize = scaleWindowSize(config.windowSize, mainWindowResponsiveScale);
  const width = windowSize.width;
  const height = windowSize.height;

  mainWindow = new BrowserWindow({
    width,
    height,
    ...clampBounds({ width, height, x: config.windowPosition?.x ?? bounds.x + bounds.width - width - 36, y: config.windowPosition?.y ?? bounds.y + bounds.height - height - 24 }, config.windowPosition ? screen.getDisplayNearestPoint(config.windowPosition).workArea : bounds),
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: Math.round(MAIN_WINDOW_LIMITS.minWidth * mainWindowResponsiveScale),
    minHeight: Math.round(MAIN_WINDOW_LIMITS.minHeight * mainWindowResponsiveScale),
    show: false,
    hasShadow: false,
    skipTaskbar: false,
    alwaysOnTop: config.alwaysOnTop !== false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  applyWindowPresentation(config);
  applyWebContentsScale(mainWindow, mainWindowResponsiveScale);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('resize', persistNativeWindowSize);
  mainWindow.on('move', scheduleResponsiveScaleUpdate);
  mainWindow.once('ready-to-show', () => {
    applyMainWindowResponsiveScale(true);
    applyWindowPresentation(readConfig());
    mainWindow.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
  secureWindow(mainWindow);
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindowResponsiveScale = getResponsiveScale(getDisplayForWindow(mainWindow));
  const settingsSize = scaleWindowSize(SETTINGS_WINDOW_SIZE, settingsWindowResponsiveScale, SETTINGS_WINDOW_SIZE);
  settingsWindow = new BrowserWindow({
    width: settingsSize.width,
    height: settingsSize.height,
    minWidth: Math.round(640 * settingsWindowResponsiveScale),
    minHeight: Math.round(560 * settingsWindowResponsiveScale),
    frame: false,
    resizable: true,
    show: false,
    backgroundColor: '#edf3f9',
    title: 'Live2D Desktop Assistant · 控制面板',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  applyWebContentsScale(settingsWindow, settingsWindowResponsiveScale);
  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWindow.on('move', scheduleResponsiveScaleUpdate);
  settingsWindow.once('ready-to-show', () => {
    applySettingsWindowResponsiveScale(true);
    settingsWindow.show();
  });
  settingsWindow.on('closed', () => { settingsWindow = null; });
  secureWindow(settingsWindow);
  return settingsWindow;
}

function secureWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.on('render-process-gone', (_event, details) => console.error('Renderer exited:', details.reason));
}
function trusted(event, roles = ['main', 'panel', 'bubble']) {
  const windows = { main: mainWindow, panel: settingsWindow, bubble: bubbleWindow };
  return roles.some(role => windows[role]?.webContents === event.sender) && event.senderFrame === event.sender.mainFrame;
}
function handle(channel, roles, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event, roles)) throw new Error('IPC 来源被拒绝');
    return fn(event, ...args);
  });
}
function broadcast(config = readConfig()) {
  for (const win of [mainWindow, settingsWindow, bubbleWindow]) if (win && !win.isDestroyed()) win.webContents.send('config-updated', config);
  return config;
}
function currentAnchor() {
  const b = mainWindow.getBounds(), scale = getWindowResponsiveScale(mainWindow);
  return { x: b.x + (modelAnchor?.x ?? b.width / scale / 2) * scale, y: b.y + (modelAnchor?.y ?? b.height / scale * .18) * scale };
}
function placeBubble() {
  if (!bubbleWindow || !mainWindow || nativeDragSessions.has(bubbleWindow.id) || windowResizeSessions.has(bubbleWindow.id)) return;
  const config = readConfig(), display = getDisplayForWindow(mainWindow), scale = getResponsiveScale(display);
  arrangingBubble = true;
  bubbleWindow.webContents.setZoomFactor(scale);
  bubbleWindow.setBounds(bubbleBounds(currentAnchor(), config.bubbleSize, config.bubbleOffset, display.workArea, scale), false);
  arrangingBubble = false;
}
function saveBubbleOffset() {
  if (arrangingBubble || !bubbleWindow || !mainWindow) return;
  const b = bubbleWindow.getBounds(), anchor = currentAnchor(), scale = getWindowResponsiveScale(bubbleWindow);
  broadcast(writeConfig({ bubbleOffset: { x: (b.x + b.width / 2 - anchor.x) / scale, y: (b.y + b.height - anchor.y) / scale + 12 } }));
}
async function showBubble() {
  if (!readConfig().selectedModelId || readConfig().bubbleDisplay === 'hidden') return false;
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    bubbleWindow = new BrowserWindow({ width: 422, height: 365, frame: false, transparent: true, show: false,
      resizable: false, hasShadow: false, skipTaskbar: true, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    secureWindow(bubbleWindow);
    bubbleWindow.on('closed', () => { bubbleWindow = null; });
    await bubbleWindow.loadFile(path.join(__dirname, 'src/index.html'), { query: { surface: 'bubble' } });
  }
  placeBubble(); applyWindowPresentation();
  bubbleWindow.webContents.send('bubble-open'); bubbleWindow.show();
  return true;
}
function selectModel(id) {
  const meta = id ? modelManager.get(id) : null;
  if (meta) modelManager.descriptor(id);
  const saved = writeConfig({ selectedModelId: meta?.id || '', modelName: meta?.name || '', modelPath: meta?.path || '', modelMode: meta?.type || 'none' });
  mainWindow?.showInactive();
  if (!meta) bubbleWindow?.hide();
  broadcast(saved); return saved;
}
function announceLibrary() {
  for (const win of [mainWindow, settingsWindow, bubbleWindow]) win?.webContents.send('library-updated', modelManager.list());
}
function importModel(input) {
  const result = modelManager.import(input);
  for (const meta of result.imported) if (meta.path === path.join(__dirname, 'miku', 'miku.model3.json')) modelManager.get(meta.id).bundled = 'miku';
  modelManager.save();
  announceLibrary(); selectModel(result.imported[0].id); return result;
}
async function bridgeRead() {
  const url = new URL(readConfig().bridgeUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('桥接仅支持明确配置的本机 HTTP(S) JSON 地址');
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`桥接返回 HTTP ${response.status}`);
  let total = 0; const chunks = [];
  for await (const chunk of response.body) { total += chunk.length; if (total > 1024 * 1024) throw new Error('桥接响应超过 1 MB'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
app.whenReady().then(async () => {
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'assistant-config.json'));
  modelManager = new ModelManager(path.join(app.getPath('userData'), 'model-library.json'));
  for (const meta of modelManager.library) if (meta.bundled === 'miku') meta.path = path.join(__dirname, 'miku', 'miku.model3.json');
  modelManager.save();
  const legacy = readConfig();
  if (legacy.selectedModelId) {
    try { const meta = modelManager.get(legacy.selectedModelId); writeConfig({ modelPath: meta.path }); }
    catch { writeConfig({ selectedModelId: '', modelPath: '', modelMode: 'none', modelName: '' }); }
  }
  if (!legacy.selectedModelId && legacy.modelPath && fs.existsSync(legacy.modelPath)) {
    try { const model = modelManager.import(legacy.modelPath).imported[0]; writeConfig({ selectedModelId: model.id, modelMode: model.type }); }
    catch (error) { console.error('旧模型迁移失败', error.message); }
  }
  for (const name of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(name, scheduleResponsiveScaleUpdate);
  protocol.handle('live2d', request => modelManager.serve(request));
  const all = ['main', 'panel', 'bubble'];
  handle('get-config', all, () => readConfig());
  handle('save-config', all, (event, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('配置格式无效');
    const current = readConfig(), next = { ...patch };
    for (const key of ['modelPath', 'modelName', 'modelMode', 'selectedModelId', 'schemaVersion', 'windowPosition']) delete next[key];
    if (!trusted(event, ['panel'])) for (const key of ['windowSize', 'autoStart', 'bridgeUrl', 'dataSourceMode']) delete next[key];
    if (current.layoutLocked) for (const key of ['windowSize', 'modelPosition', 'modelScale', 'bubbleSize', 'bubblePosition', 'bubbleOffset']) delete next[key];
    if (next.autoStart !== undefined && next.autoStart !== current.autoStart) app.setLoginItemSettings({ openAtLogin: Boolean(next.autoStart), path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
    const saved = writeConfig(next);
    applyWindowPresentation(saved);
    if (next.windowSize) applyMainWindowResponsiveScale(true);
    placeBubble();
    if (saved.bubbleDisplay === 'hidden') bubbleWindow?.hide();
    if (saved.bubbleDisplay === 'always') void showBubble();
    return broadcast(saved);
  });
  handle('reset-settings', ['panel'], () => {
    const c = readConfig();
    if (c.autoStart) app.setLoginItemSettings({ openAtLogin: false, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
    const saved = writeConfig({ ...defaults(), selectedModelId: c.selectedModelId, modelPath: c.modelPath, modelName: c.modelName, modelMode: c.modelMode });
    applyWindowPresentation(saved); applyMainWindowResponsiveScale(true); placeBubble(); return broadcast(saved);
  });
  handle('list-models', all, () => modelManager.list());
  handle('import-model', ['panel'], (_event, input) => { if (typeof input !== 'string' || input.length > 4096) throw new Error('导入路径无效'); return importModel(input); });
  handle('pick-model', ['panel'], async (_event, mode) => {
    const result = await dialog.showOpenDialog(settingsWindow, { title: '导入完整 Live2D 模型', properties: mode === 'directory' ? ['openDirectory'] : ['openFile'], filters: [{ name: 'Live2D / 图片', extensions: ['json', 'model', 'moc3', 'png', 'jpg', 'jpeg', 'webp'] }] });
    return result.canceled ? null : importModel(result.filePaths[0]);
  });
  handle('add-bundled-model', ['panel'], () => importModel(path.join(__dirname, 'miku/miku.model3.json')));
  handle('select-model', ['panel'], (_event, id) => selectModel(String(id || '')));
  handle('remove-model', ['panel'], (_event, id) => { modelManager.remove(id); if (readConfig().selectedModelId === id) selectModel(''); announceLibrary(); return true; });
  handle('rescan-model', ['panel'], (_event, id) => { const result = modelManager.import(modelManager.get(id).path); announceLibrary(); if (readConfig().selectedModelId === id) mainWindow.webContents.send('reload-model'); return result; });
  handle('reload-model', ['panel'], () => { mainWindow.webContents.send('reload-model'); return true; });
  handle('model-descriptor', all, (_event, id) => modelManager.descriptor(id || readConfig().selectedModelId));
  handle('open-library-folder', ['panel'], async () => shell.openPath(path.dirname(modelManager.file)));
  handle('play-action', ['panel', 'bubble'], async (_event, action, loop) => {
    const meta = modelManager.get(readConfig().selectedModelId);
    const resolved = actionCatalog.resolve(meta, action);
    if (!resolved) throw new Error('动作不属于当前模型');
    mainWindow.webContents.send('play-action', { action: resolved, loop: loop === true }); return true;
  });
  handle('stop-action', all, () => { mainWindow.webContents.send('stop-action'); return true; });
  handle('motion-status', ['main'], (_event, status) => {
    motionStatus = { ok: status?.ok === true, message: String(status?.message || '').slice(0, 500) };
    for (const win of [settingsWindow, bubbleWindow]) win?.webContents.send('motion-status', motionStatus);
  });
  handle('model-anchor', ['main'], (_event, point) => { if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) { modelAnchor = { x: point.x, y: point.y }; placeBubble(); } return true; });
  handle('show-bubble', ['main', 'panel'], () => showBubble());
  handle('hide-bubble', ['bubble'], () => { bubbleWindow?.hide(); return true; });
  handle('bridge-read', all, bridgeRead);
  handle('open-chatgpt', all, async () => { await shell.openExternal('https://chatgpt.com'); return true; });
  handle('open-settings', all, () => { createSettingsWindow(); return true; });
  handle('close-settings', ['panel'], () => { settingsWindow?.close(); return true; });
  handle('quit-assistant', all, () => { app.quit(); return true; });
  handle('hide-assistant', all, () => { mainWindow?.hide(); bubbleWindow?.hide(); return true; });
  handle('show-assistant', all, () => { mainWindow?.show(); return true; });
  for (const [channel, fn] of Object.entries({ 'begin-window-drag': beginNativeWindowDrag, 'end-window-drag': endNativeWindowDrag, 'resize-window': queueWindowResize })) ipcMain.on(channel, (event, arg) => { if (trusted(event, ['main', 'bubble'])) fn(event, arg); });
  handle('begin-window-resize', ['main', 'bubble'], beginWindowResize);
  handle('end-window-resize', ['main', 'bubble'], endWindowResize);
  createWindow(); createSettingsWindow();
  if (process.argv.includes('--verify') && process.env.LDA_TEST_PROFILE) require('./scripts/verify-electron.cjs')({ app, getWindows: () => ({ mainWindow, settingsWindow, bubbleWindow }), modelManager, readConfig, writeConfig, selectModel, showBubble, motionStatus: () => motionStatus });
}).catch(error => { dialog.showErrorBox('助手启动失败', error.message); app.quit(); });
app.on('before-quit', () => { for (const session of nativeDragSessions.values()) clearInterval(session.timer); });
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (mainWindow) { mainWindow.show(); createSettingsWindow(); } });
