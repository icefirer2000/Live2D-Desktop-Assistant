const { app, BrowserWindow, ipcMain, shell, screen, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
const live2dRoots = new Map();
const nativeDragSessions = new Map();
const pendingWindowSizes = new Map();
const windowSizeTimers = new Map();
const windowResizeSessions = new Map();
let nativeWindowSizeTimer = null;
const MAIN_WINDOW_SIZE = Object.freeze({ width: 460, height: 640 });
const MAIN_WINDOW_LIMITS = Object.freeze({ minWidth: 320, minHeight: 420 });

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
}

function persistNativeWindowSize() {
  if (nativeWindowSizeTimer) return;
  nativeWindowSizeTimer = setTimeout(() => {
    nativeWindowSizeTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [width, height] = mainWindow.getSize();
    const saved = writeConfig({ ...readConfig(), windowSize: { width, height } });
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('config-updated', saved);
    }
  }, 120);
}

function updateNativeWindowDrag(windowId) {
  const session = nativeDragSessions.get(windowId);
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
    win.setPosition(x, y, false);
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
}

function beginNativeWindowDrag(event) {
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
    const size = normalizeWindowSize(pending);
    win.setSize(size.width, size.height, false);
    return true;
  }
  const dx = pending.cursorX - session.cursorX;
  const dy = pending.cursorY - session.cursorY;
  const growsLeft = session.edge.includes('w');
  const growsTop = session.edge.includes('n');
  const width = Math.max(MAIN_WINDOW_LIMITS.minWidth, Math.round(session.width + (growsLeft ? -dx : session.edge.includes('e') ? dx : 0)));
  const height = Math.max(MAIN_WINDOW_LIMITS.minHeight, Math.round(session.height + (growsTop ? -dy : session.edge.includes('s') ? dy : 0)));
  const x = Math.round(session.windowX + (growsLeft ? session.width - width : 0));
  const y = Math.round(session.windowY + (growsTop ? session.height - height : 0));
  win.setBounds({ x, y, width, height }, false);
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
  win.webContents.send('resize-mode', false);
  return true;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.json': 'application/json; charset=utf-8',
    '.moc3': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
  }[ext] || 'application/octet-stream';
}

async function serveLive2D(request) {
  const url = new URL(request.url);
  const source = live2dRoots.get(url.hostname);
  if (!source) return new Response('Unknown Live2D source', { status: 404 });

  const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  const filePath = path.resolve(source.root, relativePath);
  if (!isPathInside(source.root, filePath) || !fs.existsSync(filePath)) {
    return new Response('Live2D asset not found', { status: 404 });
  }

  if (source.virtualModel && relativePath.toLowerCase() === source.entryName.toLowerCase()) {
    return new Response(JSON.stringify(source.virtualModel), {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
  const data = await fs.promises.readFile(filePath);
  return new Response(data, { headers: { 'content-type': mimeTypeFor(filePath) } });
}

function createVirtualModel(modelPath, root) {
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  model.FileReferences = model.FileReferences || {};
  const siblings = fs.readdirSync(root);
  const expressions = siblings
    .filter((name) => /\.exp3\.json$/i.test(name) && !/^水印\.exp3\.json$/i.test(name))
    .map((name) => ({ Name: name.replace(/\.exp3\.json$/i, ''), File: name }));
  const motions = siblings
    .filter((name) => /\.motion3\.json$/i.test(name))
    .map((name) => ({ File: name, FadeInTime: 500, FadeOutTime: 500 }));

  if (!Array.isArray(model.FileReferences.Expressions) || model.FileReferences.Expressions.length === 0) {
    if (expressions.length) model.FileReferences.Expressions = expressions;
  }
  if (!model.FileReferences.Motions || typeof model.FileReferences.Motions !== 'object') {
    if (motions.length) model.FileReferences.Motions = { Desktop: motions };
  }
  return model;
}

function configPath() {
  return path.join(app.getPath('userData'), 'assistant-config.json');
}

function defaultConfig() {
  return {
    alwaysOnTop: true,
    showDesktopBorder: false,
    layoutLocked: false,
    opacity: 1,
    bubbleFadeIn: false,
    bubbleFadeDuration: 280,
    refreshMinutes: 5,
    dataSourceMode: 'demo',
    bridgeUrl: '',
    modelName: 'miku',
    modelMode: 'live2d',
    modelPath: path.join(__dirname, 'miku', 'miku.model3.json'),
    modelScale: 1,
    modelPosition: { x: 0, y: 0 },
    bubblePosition: { x: 19, y: 12 },
    bubbleSize: { width: 422, height: 365 },
    windowSize: { ...MAIN_WINDOW_SIZE }
  };
}

function readConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const config = { ...defaultConfig(), ...saved };
    // Migrate the old built-in fallback once, preserving imported models.
    if (config.modelMode === 'fallback' && fs.existsSync(defaultConfig().modelPath)) {
      config.modelName = 'miku';
      config.modelMode = 'live2d';
      config.modelPath = defaultConfig().modelPath;
    }
    if (!config.bubblePosition || !Number.isFinite(Number(config.bubblePosition.x)) || !Number.isFinite(Number(config.bubblePosition.y))) {
      config.bubblePosition = { ...defaultConfig().bubblePosition };
    }
    if (!config.modelPosition || !Number.isFinite(Number(config.modelPosition.x)) || !Number.isFinite(Number(config.modelPosition.y))) {
      config.modelPosition = { ...defaultConfig().modelPosition };
    }
    config.showDesktopBorder = config.showDesktopBorder === true;
    config.layoutLocked = config.layoutLocked === true;
    config.bubbleFadeIn = config.bubbleFadeIn === true;
    config.bubbleFadeDuration = Math.round(clampNumber(config.bubbleFadeDuration, 280, 100, 1200));
    config.windowSize = normalizeWindowSize(config.windowSize);
    config.bubbleSize = normalizeBubbleSize(config.bubbleSize);
    return config;
  } catch {
    return defaultConfig();
  }
}

function writeConfig(nextConfig) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  const saved = { ...(nextConfig || {}) };
  saved.alwaysOnTop = saved.alwaysOnTop !== false;
  saved.opacity = clampNumber(saved.opacity, 1, 0.35, 1);
  saved.showDesktopBorder = saved.showDesktopBorder === true;
  saved.layoutLocked = saved.layoutLocked === true;
  saved.bubbleFadeIn = saved.bubbleFadeIn === true;
  saved.bubbleFadeDuration = Math.round(clampNumber(saved.bubbleFadeDuration, 280, 100, 1200));
  saved.windowSize = normalizeWindowSize(saved.windowSize);
  saved.bubbleSize = normalizeBubbleSize(saved.bubbleSize);
  saved.modelPosition = {
    x: Number.isFinite(Number(saved.modelPosition?.x)) ? Number(saved.modelPosition.x) : 0,
    y: Number.isFinite(Number(saved.modelPosition?.y)) ? Number(saved.modelPosition.y) : 0
  };
  fs.writeFileSync(configPath(), JSON.stringify(saved, null, 2), 'utf8');
  return saved;
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const bounds = display.workArea;
  const config = readConfig();
  const windowSize = normalizeWindowSize(config.windowSize);
  const width = windowSize.width;
  const height = windowSize.height;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: Math.max(bounds.x + bounds.width - width - 36, bounds.x),
    y: Math.max(bounds.y + bounds.height - height - 24, bounds.y),
    frame: false,
    transparent: true,
    resizable: true,
    minWidth: MAIN_WINDOW_LIMITS.minWidth,
    minHeight: MAIN_WINDOW_LIMITS.minHeight,
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
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('resize', persistNativeWindowSize);
  mainWindow.once('ready-to-show', () => {
    applyWindowPresentation(readConfig());
    mainWindow.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 620,
    minWidth: 640,
    minHeight: 560,
    frame: false,
    resizable: true,
    show: false,
    backgroundColor: '#0d1221',
    title: 'Live2D Desktop Assistant 设置',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
  return settingsWindow;
}

app.whenReady().then(() => {
  protocol.handle('live2d', serveLive2D);
  ipcMain.handle('get-config', () => readConfig());
  ipcMain.handle('get-default-model-path', () => defaultConfig().modelPath);
  ipcMain.handle('save-config', (event, config) => {
    // Settings from the renderer are also used for model scale/position and
    // dialog state. Always take the live native size here so those saves can
    // never replay a stale windowSize and resize the desktop window.
    const nextConfig = { ...(config || {}) };
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [width, height] = mainWindow.getSize();
      nextConfig.windowSize = { width, height };
    }
    const saved = writeConfig(nextConfig);
    if (mainWindow && !mainWindow.isDestroyed()) {
      applyWindowPresentation(saved);
      if (event.sender !== mainWindow.webContents) mainWindow.webContents.send('config-updated', saved);
    }
    if (settingsWindow && !settingsWindow.isDestroyed() && event.sender !== settingsWindow.webContents) {
      settingsWindow.webContents.send('config-updated', saved);
    }
    return saved;
  });
  ipcMain.handle('load-live2d-model', (_event, modelPath) => {
    const absolutePath = path.resolve(String(modelPath || ''));
    if (!absolutePath.toLowerCase().endsWith('.model3.json')) {
      throw new Error('请选择 .model3.json 模型入口文件');
    }
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error('找不到所选 Live2D 模型文件');
    }

    const token = crypto.randomUUID().replace(/-/g, '');
    const root = path.dirname(absolutePath);
    let virtualModel;
    try {
      virtualModel = createVirtualModel(absolutePath, root);
    } catch {
      throw new Error('模型入口文件不是有效的 JSON');
    }
    live2dRoots.set(token, {
      root,
      entryName: path.basename(absolutePath),
      virtualModel
    });
    return {
      modelUrl: `live2d://${token}/${encodeURIComponent(path.basename(absolutePath))}`,
      modelPath: absolutePath,
      modelName: path.basename(absolutePath).replace(/\.model3\.json$/i, ''),
      actions: {
        expressions: virtualModel.FileReferences.Expressions || [],
        motions: Object.entries(virtualModel.FileReferences.Motions || {}).flatMap(([group, entries]) =>
          entries.map((entry, index) => ({ group, index, file: entry.File })))
      }
    };
  });
  ipcMain.handle('open-chatgpt', async () => {
    await shell.openExternal('https://chatgpt.com');
    return true;
  });
  ipcMain.handle('open-settings', () => {
    createSettingsWindow();
    return true;
  });
  ipcMain.on('begin-window-drag', beginNativeWindowDrag);
  ipcMain.on('end-window-drag', endNativeWindowDrag);
  ipcMain.on('resize-window', queueWindowResize);
  ipcMain.on('end-window-resize', (event) => {
    endWindowResize(event);
  });
  ipcMain.handle('begin-window-resize', beginWindowResize);
  ipcMain.handle('end-window-resize', endWindowResize);
  ipcMain.handle('close-settings', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('resize-mode', false);
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    return true;
  });
  ipcMain.handle('hide-assistant', () => {
    if (mainWindow) mainWindow.hide();
    return true;
  });
  ipcMain.handle('quit-assistant', () => {
    app.quit();
    return true;
  });
  createWindow();
  createSettingsWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
