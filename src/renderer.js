const isBubbleSurface = new URLSearchParams(location.search).get('surface') === 'bubble';
document.body.classList.toggle('bubble-surface', isBubbleSurface);
document.title = isBubbleSurface ? 'Live2D Assistant · 聊天框' : 'Live2D Assistant · 桌面模型';
const motionManager = new window.MotionManager();
const state = {
  config: {},
  currentView: 'menu',
  modelFileName: '尚未选择模型',
  modelMode: 'none',
  modelPath: '',
  usage: {
    short: { label: '5 小时额度', used: 54, reset: '今天 21:26' },
    week: { label: '1 周额度', used: 65, reset: '9 月 9 日 09:14' },
    credits: 0,
    resets: 1
  },
  activities: [],
  permissions: [],
  dataSource: '演示数据',
  actionOptions: [],
  currentAction: null,
  modelScale: 1,
  modelPosition: { x: 0, y: 0 },
  bubblePosition: { x: 19, y: 12 },
  bubbleSize: { width: 422, height: 365 }
};

const MODEL_SCALE_MIN = 0.65;
const MODEL_SCALE_MAX = 1.45;
const DEFAULT_MODEL_POSITION = Object.freeze({ x: 0, y: 0 });
const MODEL_POSITION_MARGIN = 14;
const BUBBLE_MARGIN = 8;
const DEFAULT_BUBBLE_POSITION = Object.freeze({ x: 19, y: 12 });
const BUBBLE_SIZE_LIMITS = Object.freeze({ minWidth: 300, minHeight: 280, maxWidth: 720, maxHeight: 640 });
const DEFAULT_BUBBLE_SIZE = Object.freeze({ width: 422, height: 365 });
const MIKU_GREETINGS = Object.freeze([
  { title: '未来来啦♪', sub: '今天也要一起把灵感唱出来吗？' },
  { title: '初音未来，准备完毕！', sub: '告诉我想从哪一项开始，我会陪你一步一步完成。' },
  { title: '欢迎回来～', sub: '桌面上有我在，需要查看状态或继续聊天吗？' },
  { title: '叮咚！未来已上线。', sub: '让今天的任务也像旋律一样，顺顺利利地进行吧♪' },
  { title: '见到你真好！', sub: '要先看看用量，还是整理一下正在运行的聊天？' },
  { title: '连接成功，歌声就位♪', sub: '把你想知道的事情交给我，我马上帮你找。' },
  { title: '今天也一起加油吧！', sub: '无论是权限请求还是模型外观，我都可以陪你调整。' },
  { title: '准备好开始创作了吗？', sub: '选一个功能，让我们把灵感变成下一步行动。' }
]);

const $ = (selector) => document.querySelector(selector);
const bubble = $('#bubble');
const modelStage = $('#modelStage');
const menuView = $('#menuView');
const detailView = $('#detailView');
const greeting = $('#greeting');
const greetingSub = $('#greetingSub');
const sourceStatus = $('#sourceStatus');
const petModel = $('#petModel');
const customImage = $('#customImage');
const modelLabel = $('#modelLabel');
const live2dCanvas = $('#live2dCanvas');
const modelStatus = $('#modelStatus');
const actionToolbar = $('#actionToolbar');
const scaleHandle = $('#scaleHandle');
const bubbleTopline = bubble?.querySelector('.bubble-drag-handle');
const bubbleResizeHandle = $('#bubbleResizeHandle');
const windowResizeZones = [...document.querySelectorAll('.window-resize-zone')];
const desktopBorder = $('#desktopBorder');

let pixiApp = null;
let live2dModel = null;
let runtimePromise = null;
let refreshTimer = null;
let lastModelDescriptor = null;
let live2dNaturalSize = { width: 1, height: 1 };
let live2dCenterOffsetRatio = 0;

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function setGreeting(title, sub) {
  greeting.textContent = title;
  greetingSub.textContent = sub;
}

function setModelStatus(message, visible = true) {
  modelStatus.textContent = message;
  modelStatus.classList.toggle('hidden', !visible);
}

function applyDesktopBorder(config = state.config) {
  const enabled = config?.showDesktopBorder === true;
  desktopBorder?.classList.toggle('visible', enabled);
  document.body.classList.toggle('window-border-visible', enabled);
}

function applyBubbleFade(config = state.config) {
  if (!bubble) return;
  const enabled = config?.bubbleFadeIn === true;
  const duration = clamp(Number(config?.bubbleFadeDuration) || 280, 100, 1200);
  bubble.style.setProperty('--bubble-fade-duration', `${Math.round(duration)}ms`);
  bubble.classList.toggle('bubble-fade-enabled', enabled);
}

function isLayoutLocked(config = state.config) {
  return config?.layoutLocked === true;
}

function applyLayoutLock(config = state.config) {
  document.body.classList.toggle('layout-locked', isLayoutLocked(config));
}

function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  const current = [...document.scripts].find((script) => script.src === src);
  if (current) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(`运行时加载超时：${src}`)), 8000);
      current.addEventListener('load', () => { window.clearTimeout(timer); resolve(); }, { once: true });
      current.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error(`运行时加载失败：${src}`)); }, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    const timer = window.setTimeout(() => { script.remove(); reject(new Error(`运行时加载超时：${src}`)); }, 8000);
    script.onload = () => { window.clearTimeout(timer); resolve(); };
    script.onerror = () => { window.clearTimeout(timer); reject(new Error(`运行时加载失败：${src}`)); };
    document.head.appendChild(script);
  });
}

async function loadScriptCandidates(sources, ready, label) {
  let lastError = null;
  for (const source of sources) {
    if (ready()) return;
    try {
      await loadScript(source, ready);
      if (ready()) return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`${label}未找到`);
}

async function loadOptionalScriptCandidates(sources, label) {
  let lastError = null;
  for (const source of sources) {
    try {
      await loadScript(source, () => false);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`${label}未找到`);
}

async function ensureLive2DRuntime() {
  if (window.PIXI?.live2d?.Live2DModel) return;
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    await loadScriptCandidates([
      '../node_modules/pixi.js/dist/browser/pixi.min.js',
      '../runtime/pixi.min.js'
    ], () => Boolean(window.PIXI), 'Pixi');
    await loadOptionalScriptCandidates([
      '../node_modules/@pixi/unsafe-eval/dist/browser/unsafe-eval.min.js',
      '../runtime/unsafe-eval.min.js'
    ], 'Pixi unsafe-eval');
    await loadScriptCandidates([
      '../runtime/live2dcubismcore.min.js'
    ], () => Boolean(window.Live2DCubismCore), 'Cubism Core');
    await loadScriptCandidates([
      '../node_modules/pixi-live2d-display/dist/cubism4.min.js',
      '../runtime/pixi-live2d-display-cubism4.min.js'
    ], () => Boolean(window.PIXI?.live2d?.Live2DModel), 'Live2D 插件');
    if (!window.PIXI?.live2d?.Live2DModel) throw new Error('Live2D 渲染插件未就绪');
  })().catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function actionKey(action) {
  return action.type === 'motion'
    ? `motion:${action.group}:${action.index}`
    : `expression:${action.id}`;
}

function getActionOptions(descriptor) {
  return [...(descriptor?.actions?.expressions || []).map(e => ({ type: 'expression', id: e.Name, label: e.Name })),
    ...(descriptor?.actions?.motions || []).map(e => ({ type: 'motion', group: e.group, index: e.index, label: e.name || e.file }))];
}

function renderActionPicker() {
  if (!actionToolbar) return;
  if (!state.actionOptions.length) {
    actionToolbar.innerHTML = '';
    return;
  }
  const currentKey = state.currentAction ? actionKey(state.currentAction) : '';
  actionToolbar.innerHTML = state.actionOptions.map((action, index) => `
    <button type="button" data-model-action="${index}" class="${actionKey(action) === currentKey ? 'active' : ''}">${escapeHTML(action.label)}</button>
  `).join('');
}

function setActionOptions(descriptor) {
  state.actionOptions = getActionOptions(descriptor);
  const savedKey = state.currentAction && actionKey(state.currentAction);
  state.currentAction = state.actionOptions.find((action) => actionKey(action) === savedKey) || state.actionOptions[0] || null;
  renderActionPicker();
}

async function playAction(action, loop = false) {
  try {
    if (isBubbleSurface) return await window.desktopAPI.playAction(action, loop);
    const result = await motionManager.play(action, loop);
    state.currentAction = action; renderActionPicker(); return result;
  } catch (error) { setModelStatus(error.message, true); if (!isBubbleSurface) await window.desktopAPI.reportMotion({ ok: false, message: error.message }); return false; }
}

function normalizeBubblePosition(position) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  return {
    x: Number.isFinite(x) ? x : DEFAULT_BUBBLE_POSITION.x,
    y: Number.isFinite(y) ? y : DEFAULT_BUBBLE_POSITION.y
  };
}

function normalizeBubbleSize(size) {
  return {
    width: clamp(Number(size?.width) || DEFAULT_BUBBLE_SIZE.width, BUBBLE_SIZE_LIMITS.minWidth, BUBBLE_SIZE_LIMITS.maxWidth),
    height: clamp(Number(size?.height) || DEFAULT_BUBBLE_SIZE.height, BUBBLE_SIZE_LIMITS.minHeight, BUBBLE_SIZE_LIMITS.maxHeight)
  };
}

function applyBubbleSize() {
  if (isBubbleSurface) return;
  if (!bubble) return;
  // A dialog is a fixed-size surface. Its own resize handle changes this
  // state; desktop-window resizes must never scale it down to fit.
  const size = normalizeBubbleSize(state.bubbleSize);
  bubble.style.width = `${Math.round(size.width)}px`;
  bubble.style.height = `${Math.round(size.height)}px`;
  if (bubbleResizeHandle) {
    bubbleResizeHandle.title = `拖动调整对话框大小（${Math.round(state.bubbleSize.width)}×${Math.round(state.bubbleSize.height)}）`;
  }
}

function loadBubbleSize(config) {
  state.bubbleSize = normalizeBubbleSize(config?.bubbleSize);
  applyBubbleSize();
}

function clampBubblePosition(x, y) {
  // A hidden bubble reports zero offset dimensions. Use the persisted size in
  // that state so reopening it cannot clamp the saved position a second time.
  const configuredSize = normalizeBubbleSize(state.bubbleSize);
  const width = bubble?.offsetWidth || configuredSize.width;
  const height = bubble?.offsetHeight || configuredSize.height;
  const maxX = Math.max(BUBBLE_MARGIN, window.innerWidth - width - BUBBLE_MARGIN);
  const maxY = Math.max(BUBBLE_MARGIN, window.innerHeight - height - BUBBLE_MARGIN);
  return {
    x: clamp(Number(x) || 0, BUBBLE_MARGIN, maxX),
    y: clamp(Number(y) || 0, BUBBLE_MARGIN, maxY)
  };
}

function applyBubblePosition() {
  if (isBubbleSurface) return;
  const next = clampBubblePosition(state.bubblePosition.x, state.bubblePosition.y);
  state.bubblePosition = next;
  state.config.bubblePosition = { ...next };
  bubble.style.left = `${Math.round(next.x)}px`;
  bubble.style.top = `${Math.round(next.y)}px`;
  bubble.style.right = 'auto';
}

function loadBubblePosition(config) {
  state.bubblePosition = normalizeBubblePosition(config?.bubblePosition);
  applyBubblePosition();
}

function normalizeModelPosition(position) {
  const x = Number(position?.x);
  const y = Number(position?.y);
  return {
    x: Number.isFinite(x) ? x : DEFAULT_MODEL_POSITION.x,
    y: Number.isFinite(y) ? y : DEFAULT_MODEL_POSITION.y
  };
}

function clampModelPosition(position) {
  const width = Math.min(petButton?.clientWidth || 360, window.innerWidth);
  const height = Math.min(petButton?.clientHeight || 500, window.innerHeight);
  const maxX = Math.max(0, (window.innerWidth - width) / 2 - MODEL_POSITION_MARGIN);
  const maxY = Math.max(0, (window.innerHeight - height) / 2 - MODEL_POSITION_MARGIN);
  const normalized = normalizeModelPosition(position);
  return {
    x: clamp(normalized.x, -maxX, maxX),
    y: clamp(normalized.y, -maxY, maxY)
  };
}

function applyModelPosition({ constrain = true } = {}) {
  const next = constrain ? clampModelPosition(state.modelPosition) : normalizeModelPosition(state.modelPosition);
  state.modelPosition = next;
  document.documentElement.style.setProperty('--model-offset-x', `${Math.round(next.x)}px`);
  document.documentElement.style.setProperty('--model-offset-y', `${Math.round(next.y)}px`);
}

function loadModelPosition(config) {
  state.modelPosition = normalizeModelPosition(config?.modelPosition);
  applyModelPosition();
}

function getLive2DFitScale(width, height) {
  const naturalWidth = Math.max(live2dNaturalSize.width, 1);
  const naturalHeight = Math.max(live2dNaturalSize.height, 1);
  // Leave a deliberate safety margin so the scale handle can enlarge Miku
  // without clipping hair, feet, or transparent model bounds.
  return Math.min((width * 0.92) / naturalWidth, (height * 0.84) / naturalHeight);
}

function getModelScaleLimit() {
  // Model scale is intentionally independent of the native window dimensions.
  return MODEL_SCALE_MAX;
}

function updateModelScaleUI() {
  state.modelScale = clamp(Number(state.modelScale) || 1, MODEL_SCALE_MIN, getModelScaleLimit());
  document.documentElement.style.setProperty('--model-scale', state.modelScale.toFixed(3));
  if (scaleHandle) scaleHandle.title = `拖动调整模型大小（${Math.round(state.modelScale * 100)}%，最大 ${Math.round(getModelScaleLimit() * 100)}%）`;
  resizeLive2D();
}

function disposeLive2D() {
  motionManager.attach(null);
  if (live2dModel) {
    pixiApp?.stage.removeChild(live2dModel);
    live2dModel.destroy({ children: true, texture: true, baseTexture: true });
    live2dModel = null;
  }
  // Reuse the WebGL surface: destroying it invalidates the context on this canvas.
  live2dNaturalSize = { width: 1, height: 1 };
  live2dCenterOffsetRatio = 0;
  live2dCanvas.classList.remove('visible');
  petModel.classList.add('live2d-hidden');
  setModelStatus('', false);
}

function resizeLive2D() {
  if (!pixiApp || !live2dModel) return;
  // Pixi writes the initial 264x360 size onto the canvas element. Read the
  // responsive model container instead, otherwise a resized desktop window
  // would leave the WebGL surface at its bootstrap dimensions.
  const width = petButton?.clientWidth || live2dCanvas.clientWidth || 264;
  const height = petButton?.clientHeight || live2dCanvas.clientHeight || 360;
  live2dCanvas.style.width = `${width}px`;
  live2dCanvas.style.height = `${height}px`;
  pixiApp.renderer.resize(width, height);
  const naturalWidth = Math.max(live2dNaturalSize.width, 1);
  const naturalHeight = Math.max(live2dNaturalSize.height, 1);
  // Calibrate once against the intended model surface, rather than the
  // current window. A native window resize should not change model scale.
  const fitScale = getLive2DFitScale(width / MODEL_SCALE_MAX, height / MODEL_SCALE_MAX);
  const safeMax = getModelScaleLimit();
  state.modelScale = clamp(Number(state.modelScale) || 1, MODEL_SCALE_MIN, safeMax);
  document.documentElement.style.setProperty('--model-scale', state.modelScale.toFixed(3));
  if (scaleHandle) scaleHandle.title = `拖动调整模型大小（${Math.round(state.modelScale * 100)}%，最大 ${Math.round(safeMax * 100)}%）`;
  const scale = fitScale * state.modelScale;
  live2dModel.scale.set(scale);
  // Miku's supplied model includes a large optional effect layer on the
  // left. Keep the character itself centered instead of centering that
  // transparent/effect-expanded model bounds.
  live2dModel.x = width / 2 - (width * live2dCenterOffsetRatio);
  // The model uses a bottom anchor; place that anchor so the rendered model
  // remains centered as the transparent window grows or shrinks.
  live2dModel.y = height / 2 + (naturalHeight * scale) / 2;
}

async function showLive2DModel(descriptor, persist = true) {
  setModelStatus('正在加载 Live2D…');
  try {
    await ensureLive2DRuntime();
    disposeLive2D();
    if (!pixiApp) pixiApp = new window.PIXI.Application({
      view: live2dCanvas,
      width: 264,
      height: 360,
      transparent: true,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true
    });
    // Keep Live2D animated while avoiding a full-rate software-rendering loop.
    pixiApp.ticker.maxFPS = 24;
    live2dModel = await window.PIXI.live2d.Live2DModel.from(descriptor.modelUrl, { autoInteract: false });
    // The supplied Miku file stores the optional "圈圈" effect enabled in its
    // initial parameter state. Keep the default pose clean; choosing the
    // action explicitly can still turn the effect on.
    try { live2dModel.internalModel?.coreModel?.setParameterValueById?.('Param125', 0); } catch { /* optional model parameter */ }
    lastModelDescriptor = descriptor;
    motionManager.attach(live2dModel);
    live2dNaturalSize = { width: Math.max(live2dModel.width, 1), height: Math.max(live2dModel.height, 1) };
    live2dCenterOffsetRatio = /^miku$/i.test(String(descriptor.modelName || '')) ? 0.18 : 0;
    setActionOptions(descriptor);
    live2dModel.anchor.set(0.5, 1);
    live2dModel.interactive = false;
    pixiApp.stage.addChild(live2dModel);
    live2dCanvas.classList.add('visible');
    petModel.classList.add('live2d-hidden');
    customImage.classList.remove('visible');
    state.modelFileName = descriptor.modelName;
    state.modelMode = 'live2d';
    state.modelPath = descriptor.modelPath;
    state.config.modelName = descriptor.modelName;
    state.config.modelMode = 'live2d';
    state.config.modelPath = descriptor.modelPath;
    modelLabel.textContent = `${descriptor.modelName} · Live2D 模型`;
    setModelStatus('', false);
    updateModelScaleUI();
    resizeLive2D();
    if (persist) await saveConfig();
  } catch (error) {
    disposeLive2D();
    setModelStatus('Live2D 加载失败', true);
    setGreeting('模型没有加载成功。', '请确认选择的是完整的 .model3.json 文件夹。');
    console.error(error);
    throw error;
  }
}

function openBubble() {
  if (!isBubbleSurface) { void window.desktopAPI.showBubble(); return; }
  if (!bubble || !bubble.classList.contains('hidden')) return;
  applyBubbleFade();
  applyBubbleSize();
  applyBubblePosition();
  bubble.classList.remove('hidden');
  if (state.config.bubbleFadeIn === true) {
    bubble.classList.remove('bubble-appearing');
    void bubble.offsetWidth;
    bubble.classList.add('bubble-appearing');
  }
  const welcome = MIKU_GREETINGS[Math.floor(Math.random() * MIKU_GREETINGS.length)];
  setGreeting('你好，欢迎回来', `${state.config.modelName || '桌面伙伴'} · ${welcome.sub}`);
  showMenu();
  window.requestAnimationFrame(applyBubblePosition);
}

function closeBubble() {
  if (isBubbleSurface) void window.desktopAPI.hideBubble();
  bubble.classList.remove('bubble-appearing');
  bubble.classList.add('hidden');
  showMenu();
}

function showMenu() {
  state.currentView = 'menu';
  bubble.classList.remove('detail-open');
  menuView.classList.remove('hidden');
  detailView.classList.add('hidden');
}

function detailHeader(title) {
  return `<div class="back-row"><button class="back-button" data-action="back">← 返回</button><span class="detail-title">${title}</span><span></span></div>`;
}

function renderUsage() {
  const shortRemain = 100 - state.usage.short.used;
  const weekRemain = 100 - state.usage.week.used;
  detailView.innerHTML = `${detailHeader('剩余用量')}
    <div class="meter-block"><div class="meter-meta"><span>${escapeHTML(state.usage.short.label)} · 剩余</span><strong>${shortRemain}%</strong></div><div class="meter"><i style="width:${shortRemain}%"></i></div><div class="meter-meta"><span>重置时间</span><span>${escapeHTML(state.usage.short.reset)}</span></div></div>
    <div class="meter-block"><div class="meter-meta"><span>${escapeHTML(state.usage.week.label)} · 剩余</span><strong>${weekRemain}%</strong></div><div class="meter"><i style="width:${weekRemain}%"></i></div><div class="meter-meta"><span>重置时间</span><span>${escapeHTML(state.usage.week.reset)}</span></div></div>
    <div class="data-note">软件 Credits：<strong>${state.usage.credits}</strong> · 可用完整重置：<strong>${state.usage.resets}</strong> 次<br/>数据源：<strong>${escapeHTML(state.dataSource)}</strong> · 更新时间：${new Date(state.snapshotUpdatedAt || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>`;
  setGreeting('用量看板', '这是当前助手缓存的额度快照。');
}

function renderActivity() {
  const items = state.activities.length ? state.activities : [{ title: '暂无聊天活动', sub: '等待数据源返回任务状态', tag: '就绪', tone: 'ready' }];
  detailView.innerHTML = `${detailHeader('当前聊天')}${items.map((item) => `<div class="activity-item"><i class="activity-dot ${escapeHTML(item.tone)}"></i><span class="item-main"><span class="item-title">${escapeHTML(item.title)}</span><span class="item-sub">${escapeHTML(item.sub)}</span></span><span class="tag">${escapeHTML(item.tag)}</span></div>`).join('')}`;
  setGreeting('聊天动态', '我把最近的任务状态整理好了。');
}

function renderPermissions() {
  const items = state.permissions.length ? state.permissions : [{ title: '暂无待处理请求', sub: '当前没有需要你决定的操作', action: '查看' }];
  detailView.innerHTML = `${detailHeader('权限请求')}${items.map((item) => `<div class="permission-item"><i class="activity-dot blocked"></i><span class="item-main"><span class="item-title">${escapeHTML(item.title)}</span><span class="item-sub">${escapeHTML(item.sub)}</span></span><button class="approval-button" data-action="open-chat">${escapeHTML(item.action)}</button></div>`).join('')}<div class="data-note">权限请求会优先提醒你，再由你决定是否打开对应聊天。</div>`;
  setGreeting('有一项请求', '确认后我会带你回到对应的 ChatGPT 页面。');
}

function renderSettings() {
  const cfg = state.config;
  const modelType = state.modelMode === 'live2d' ? '真实 Live2D 模型' : (state.modelMode === 'image' ? '图片预览' : '尚未选择模型');
  detailView.innerHTML = `${detailHeader('设置模型')}
    <div class="setting-row"><span>当前模型</span><strong>${escapeHTML(state.modelFileName)}</strong></div>
    <div class="setting-row"><span>显示方式</span><strong>${modelType}</strong></div>
    <div class="setting-row"><span>模型大小</span><strong>${Math.round(state.modelScale * 100)}%</strong></div>
    <div class="setting-row"><span>始终置顶</span><strong>${cfg.alwaysOnTop === false ? '关闭' : '开启'}</strong></div>
    <div class="setting-row"><span>数据源</span><strong>${escapeHTML(state.dataSource)}</strong></div>
    <div class="settings-actions"><button class="small-action" data-action="import-model">导入图片 / 模型包</button><button class="small-action" data-action="toggle-top">切换置顶</button><button class="small-action" data-action="reset-model">恢复内置模型</button></div>
    <div class="settings-actions"><button class="small-action" data-action="open-settings-window">打开独立设置窗口</button></div>
    <div class="data-note">选择完整的 .model3.json 即可加载同目录下的 moc3、纹理和 physics3 文件。模型只读取本地路径，不会复制或上传资源。</div>`;
  setGreeting('换一个样子', '导入透明图片即可替换当前演示角色。');
}

function showDetail(view) {
  state.currentView = view;
  bubble.classList.add('detail-open');
  menuView.classList.add('hidden');
  detailView.classList.remove('hidden');
  if (view === 'usage') renderUsage();
  if (view === 'activity') renderActivity();
  if (view === 'permissions') renderPermissions();
  if (view === 'settings') renderSettings();
  window.requestAnimationFrame(applyBubblePosition);
}

async function refreshData(showError = false) {
  const provider = window.assistantDataProvider?.create(state.config) || { read: async () => ({}) };
  try {
    const snapshot = window.assistantDataProvider?.normalize(await provider.read()) || {};
    state.usage = snapshot.usage || state.usage;
    state.activities = snapshot.activities || [];
    state.permissions = snapshot.permissions || [];
    state.dataSource = snapshot.source || '演示数据';
    state.snapshotUpdatedAt = snapshot.updatedAt || new Date().toISOString();
    sourceStatus.textContent = `${state.dataSource} · ${new Date(state.snapshotUpdatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新`;
    if (state.currentView === 'usage') renderUsage();
    if (state.currentView === 'activity') renderActivity();
    if (state.currentView === 'permissions') renderPermissions();
  } catch (error) {
    state.dataSource = '桥接不可用（保留上次快照）';
    sourceStatus.textContent = `桥接失败 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    if (showError) setGreeting('数据暂时不可用。', error.message || '已保留上一次快照。');
    console.warn('数据源刷新失败，继续使用当前快照', error);
  }
}

function scheduleRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  const minutes = Math.max(1, Number(state.config.refreshMinutes) || 5);
  refreshTimer = window.setInterval(() => refreshData(false), minutes * 60 * 1000);
}

function handleCommand(value) {
  const text = value.trim().toLowerCase();
  if (!text) return;
  if (text.includes('余额') || text.includes('用量') || text.includes('额度')) showDetail('usage');
  else if (text.includes('聊天') || text.includes('运行')) showDetail('activity');
  else if (text.includes('权限') || text.includes('批准') || text.includes('审批')) showDetail('permissions');
  else if (text.includes('设置') || text.includes('模型')) showDetail('settings');
  else {
    setGreeting('我听到了。', '目前我可以帮你查看用量、当前聊天、权限请求和模型设置。');
    detailView.classList.add('hidden');
    menuView.classList.remove('hidden');
  }
}

async function saveConfig() {
  if (window.desktopAPI) {
    const keys = ['modelScale', 'modelPosition', 'alwaysOnTop'];
    state.config = await window.desktopAPI.saveConfig(Object.fromEntries(keys.map(key => [key, state.config[key]])));
  }
}

let windowDragState = null;

function canBeginWholeLayoutDrag(target) { return !isLayoutLocked() && target === modelStage; }

function beginPeripheralWindowDrag(event) {
  // Unlocked: only uncovered stage drags the native window. Locked: Miku and
  // non-interactive dialog space join that surface so the layout moves as one.
  if (event.button !== 0 || !canBeginWholeLayoutDrag(event.target) || !window.desktopAPI?.beginWindowDrag) return;
  if (windowDragState) return;
  windowDragState = {
    pointerId: event.pointerId,
    surface: event.currentTarget,
    startClientX: event.clientX,
    startClientY: event.clientY,
    moved: false,
    startedOnPet: Boolean(event.target.closest('#petButton'))
  };
  document.body.classList.add('window-dragging');
  window.desktopAPI.beginWindowDrag();
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* pointer capture is optional for native drag */ }
}

function trackPeripheralWindowDrag(event) {
  if (!windowDragState || event.pointerId !== windowDragState.pointerId) return;
  const dx = event.clientX - windowDragState.startClientX;
  const dy = event.clientY - windowDragState.startClientY;
  if (!windowDragState.moved && Math.hypot(dx, dy) >= 4) windowDragState.moved = true;
  // Let a stationary model press produce its normal click. A real drag is
  // still prevented from becoming a click after the native move completes.
  if (windowDragState.moved) event.preventDefault();
}

function finishPeripheralWindowDrag(event) {
  if (!windowDragState || event.pointerId !== windowDragState.pointerId) return;
  const { moved, startedOnPet } = windowDragState;
  window.desktopAPI?.endWindowDrag?.();
  try { windowDragState.surface?.releasePointerCapture?.(event.pointerId); } catch { /* pointer may already be released */ }
  windowDragState = null;
  document.body.classList.remove('window-dragging');
  if (moved) {
    if (startedOnPet) {
      suppressNextPetClick = true;
      ignorePetClickUntil = performance.now() + 350;
    }
    event.preventDefault();
  } else if (startedOnPet && isLayoutLocked()) {
    // Native dragging owns the pointer sequence in a frameless Electron
    // window and can consume Chromium's ordinary click. Re-emit the intended
    // pet interaction only when this was a stationary press, never a drag.
    openBubble();
  }
}

modelStage?.addEventListener('pointerdown', beginPeripheralWindowDrag);
modelStage?.addEventListener('pointermove', trackPeripheralWindowDrag);
modelStage?.addEventListener('pointerup', finishPeripheralWindowDrag);
modelStage?.addEventListener('pointercancel', finishPeripheralWindowDrag);
bubble?.addEventListener('pointerdown', beginPeripheralWindowDrag);
bubble?.addEventListener('pointermove', trackPeripheralWindowDrag);
bubble?.addEventListener('pointerup', finishPeripheralWindowDrag);
bubble?.addEventListener('pointercancel', finishPeripheralWindowDrag);

function applyModel(name, mode, imageUrl, persist = true) {
  if (mode !== 'live2d') disposeLive2D();
  state.modelFileName = name;
  state.modelMode = mode;
  if (imageUrl) {
    customImage.src = imageUrl;
    customImage.classList.add('visible');
    petModel.classList.add('custom-mode');
  } else {
    customImage.classList.remove('visible');
    petModel.classList.remove('custom-mode');
  }
  modelLabel.textContent = mode === 'image' ? `${name} · 图片预览` : (mode === 'model-package' ? `${name} · 模型包入口` : `${name} · Live2D 演示模型`);
  state.config.modelName = name;
  state.config.modelMode = mode;
  if (mode !== 'live2d') {
    state.modelPath = '';
    delete state.config.modelPath;
  }
  if (persist) {
    if (mode === 'image' && imageUrl) localStorage.setItem('customModelImage', imageUrl);
    if (mode !== 'image') localStorage.removeItem('customModelImage');
    saveConfig();
  }
}

let dragState = null;
let modelDragFrame = 0;
let pendingModelPosition = null;
let suppressNextPetClick = false;
let ignorePetClickUntil = 0;

function flushModelPosition() {
  modelDragFrame = 0;
  if (!dragState || !pendingModelPosition) return;
  state.modelPosition = pendingModelPosition;
  pendingModelPosition = null;
  applyModelPosition();
}

function beginPetDrag(event) {
  if (event.button !== 0 || isLayoutLocked()) return;
  window.desktopAPI.beginWindowDrag();
  if (dragState) return;
  dragState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPosition: { ...state.modelPosition },
    startScreenX: event.screenX, startScreenY: event.screenY,
    moved: false
  };
  document.body.classList.add('dragging');
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* synthetic/test pointers may not be capturable */ }
  event.preventDefault();
}

function trackPetDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  if (Math.hypot(event.screenX - dragState.startScreenX, event.screenY - dragState.startScreenY) >= 4) dragState.moved = true;
  event.preventDefault();
}

function finishPetDrag(event) {
  window.desktopAPI.endWindowDrag();
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  if (modelDragFrame) {
    window.cancelAnimationFrame(modelDragFrame);
    flushModelPosition();
  }
  if (dragState.moved) {
    // Chromium may synthesize a click after pointerup, even when the pointer
    // moved. Guard a short window so a completed drag never triggers a pose.
    suppressNextPetClick = true;
    ignorePetClickUntil = performance.now() + 350;
    state.config.modelPosition = { ...state.modelPosition };
    void saveConfig();
  }
  try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* pointer may already be released */ }
  dragState = null;
  pendingModelPosition = null;
  document.body.classList.remove('dragging');
  event.preventDefault();
}

function cancelPetDrag(event) {
  window.desktopAPI.endWindowDrag();
  if (modelDragFrame) {
    window.cancelAnimationFrame(modelDragFrame);
    flushModelPosition();
  }
  if (dragState?.moved) {
    suppressNextPetClick = true;
    ignorePetClickUntil = performance.now() + 350;
    state.config.modelPosition = { ...state.modelPosition };
    void saveConfig();
  }
  dragState = null;
  pendingModelPosition = null;
  document.body.classList.remove('dragging');
  event.preventDefault();
}

// The canvas bubbles its pointer events to this single host. Keeping one
// handler avoids duplicate drag starts while allowing real Live2D pixels to
// move independently inside the transparent desktop window.
petButton?.addEventListener('pointerdown', beginPetDrag);
petButton?.addEventListener('pointermove', trackPetDrag);
petButton?.addEventListener('pointerup', finishPetDrag);
petButton?.addEventListener('pointercancel', cancelPetDrag);

$('#petButton').addEventListener('click', () => {
  if (suppressNextPetClick || performance.now() < ignorePetClickUntil) {
    suppressNextPetClick = false;
    return;
  }
  openBubble();
});

let bubbleDragState = null;
let bubbleDragFrame = 0;
let pendingBubblePosition = null;

let windowResizeState = null;
let windowResizeFrame = 0;
let pendingWindowResize = null;

function flushWindowResize() {
  windowResizeFrame = 0;
  if (!windowResizeState || !pendingWindowResize) return;
  const next = pendingWindowResize;
  pendingWindowResize = null;
  window.desktopAPI?.resizeWindow?.(next);
}

function finishWindowResize(event) {
  if (!windowResizeState || event.pointerId !== windowResizeState.pointerId) return;
  if (windowResizeFrame) {
    window.cancelAnimationFrame(windowResizeFrame);
    flushWindowResize();
  }
  pendingWindowResize = { cursorX: event.screenX, cursorY: event.screenY };
  flushWindowResize();
  void window.desktopAPI?.endWindowResize?.();
  try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* pointer may already be released */ }
  windowResizeState = null;
  document.body.classList.remove('window-resizing');
  event.preventDefault();
  event.stopPropagation();
}

windowResizeZones.forEach((zone) => {
  zone.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isLayoutLocked() || !window.desktopAPI?.beginWindowResize) return;
    windowResizeState = { pointerId: event.pointerId, edge: zone.dataset.edge };
    pendingWindowResize = { cursorX: event.screenX, cursorY: event.screenY };
    document.body.classList.add('window-resizing');
    void window.desktopAPI.beginWindowResize(zone.dataset.edge);
    try { zone.setPointerCapture?.(event.pointerId); } catch { /* synthetic/test pointers may not be capturable */ }
    event.preventDefault();
    event.stopPropagation();
  });

  zone.addEventListener('pointermove', (event) => {
    if (!windowResizeState || event.pointerId !== windowResizeState.pointerId) return;
    pendingWindowResize = { cursorX: event.screenX, cursorY: event.screenY };
    if (!windowResizeFrame) windowResizeFrame = window.requestAnimationFrame(flushWindowResize);
    event.preventDefault();
    event.stopPropagation();
  });

  zone.addEventListener('pointerup', finishWindowResize);
  zone.addEventListener('pointercancel', finishWindowResize);
});

function flushBubblePosition() {
  bubbleDragFrame = 0;
  if (!pendingBubblePosition) return;
  state.bubblePosition = pendingBubblePosition;
  pendingBubblePosition = null;
  applyBubblePosition();
}

function finishBubbleDrag(event) {
  if (!bubbleDragState || event.pointerId !== bubbleDragState.pointerId) return;
  if (bubbleDragFrame) {
    window.cancelAnimationFrame(bubbleDragFrame);
    flushBubblePosition();
  }
  const moved = bubbleDragState.moved;
  try { bubbleTopline.releasePointerCapture?.(event.pointerId); } catch { /* pointer may already be released */ }
  bubbleDragState = null;
  bubble.classList.remove('bubble-dragging');
  if (moved) {
    state.config.bubblePosition = { ...state.bubblePosition };
    saveConfig();
  }
  event.preventDefault();
  event.stopPropagation();
}

bubbleTopline?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || isLayoutLocked() || event.target.closest('button')) return;
  bubbleDragState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPosition: { ...state.bubblePosition },
    moved: false
  };
  bubble.classList.add('bubble-dragging');
  try { bubbleTopline.setPointerCapture?.(event.pointerId); } catch { /* synthetic/test pointers may not be capturable */ }
  event.preventDefault();
  event.stopPropagation();
});

bubbleTopline?.addEventListener('pointermove', (event) => {
  if (!bubbleDragState || event.pointerId !== bubbleDragState.pointerId) return;
  const dx = event.clientX - bubbleDragState.startClientX;
  const dy = event.clientY - bubbleDragState.startClientY;
  if (!bubbleDragState.moved && Math.hypot(dx, dy) < 3) return;
  bubbleDragState.moved = true;
  pendingBubblePosition = clampBubblePosition(
    bubbleDragState.startPosition.x + dx,
    bubbleDragState.startPosition.y + dy
  );
  if (!bubbleDragFrame) bubbleDragFrame = window.requestAnimationFrame(flushBubblePosition);
  event.preventDefault();
  event.stopPropagation();
});

bubbleTopline?.addEventListener('pointerup', finishBubbleDrag);
bubbleTopline?.addEventListener('pointercancel', finishBubbleDrag);

let bubbleResizeState = null;
let bubbleResizeFrame = 0;
let pendingBubbleSize = null;

function getBubbleTransformScale() {
  if (!bubble) return 1;
  const rect = bubble.getBoundingClientRect();
  return Math.max(0.1, rect.width / Math.max(bubble.offsetWidth, 1));
}

function flushBubbleSize() {
  bubbleResizeFrame = 0;
  if (!pendingBubbleSize) return;
  state.bubbleSize = normalizeBubbleSize(pendingBubbleSize);
  pendingBubbleSize = null;
  applyBubbleSize();
  applyBubblePosition();
}

function finishBubbleResize(event) {
  if (!bubbleResizeState || event.pointerId !== bubbleResizeState.pointerId) return;
  if (bubbleResizeFrame) {
    window.cancelAnimationFrame(bubbleResizeFrame);
    flushBubbleSize();
  }
  const finalSize = pendingBubbleSize || normalizeBubbleSize({
    width: bubbleResizeState.startWidth + (event.clientX - bubbleResizeState.startClientX) / bubbleResizeState.transformScale,
    height: bubbleResizeState.startHeight + (event.clientY - bubbleResizeState.startClientY) / bubbleResizeState.transformScale
  });
  pendingBubbleSize = null;
  state.bubbleSize = finalSize;
  state.config.bubbleSize = { ...finalSize };
  applyBubbleSize();
  applyBubblePosition();
  void saveConfig();
  try { bubbleResizeHandle.releasePointerCapture?.(event.pointerId); } catch { /* pointer may already be released */ }
  bubbleResizeState = null;
  document.body.classList.remove('bubble-resizing');
  event.preventDefault();
  event.stopPropagation();
}

bubbleResizeHandle?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || isLayoutLocked()) return;
  event.stopPropagation();
  event.preventDefault();
  try { bubbleResizeHandle.setPointerCapture?.(event.pointerId); } catch { /* synthetic/test pointers may not be capturable */ }
  bubbleResizeState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startWidth: bubble.offsetWidth,
    startHeight: bubble.offsetHeight,
    transformScale: getBubbleTransformScale()
  };
  pendingBubbleSize = null;
  document.body.classList.add('bubble-resizing');
});

bubbleResizeHandle?.addEventListener('pointermove', (event) => {
  if (!bubbleResizeState || event.pointerId !== bubbleResizeState.pointerId) return;
  pendingBubbleSize = normalizeBubbleSize({
    width: bubbleResizeState.startWidth + (event.clientX - bubbleResizeState.startClientX) / bubbleResizeState.transformScale,
    height: bubbleResizeState.startHeight + (event.clientY - bubbleResizeState.startClientY) / bubbleResizeState.transformScale
  });
  if (!bubbleResizeFrame) bubbleResizeFrame = window.requestAnimationFrame(flushBubbleSize);
  event.stopPropagation();
  event.preventDefault();
});

bubbleResizeHandle?.addEventListener('pointerup', finishBubbleResize);
bubbleResizeHandle?.addEventListener('pointercancel', finishBubbleResize);

scaleHandle?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || isLayoutLocked()) return;
  event.stopPropagation();
  event.preventDefault();
  try { scaleHandle.setPointerCapture?.(event.pointerId); } catch { /* synthetic/test pointers may not be capturable */ }
  scaleHandle.dataset.pointerId = String(event.pointerId);
  scaleHandle._scaleStart = { x: event.clientX, y: event.clientY, value: state.modelScale };
  document.body.classList.add('scaling');
});

scaleHandle?.addEventListener('pointermove', (event) => {
  const start = scaleHandle._scaleStart;
  if (!start || String(event.pointerId) !== scaleHandle.dataset.pointerId) return;
  const delta = (event.clientX - start.x) + (event.clientY - start.y);
  state.modelScale = clamp(start.value + delta / 420, MODEL_SCALE_MIN, getModelScaleLimit());
  updateModelScaleUI();
  if (state.currentView === 'settings') renderSettings();
  event.stopPropagation();
  event.preventDefault();
});

function finishScale(event) {
  if (!scaleHandle._scaleStart || String(event.pointerId) !== scaleHandle.dataset.pointerId) return;
  try { scaleHandle.releasePointerCapture?.(event.pointerId); } catch { /* pointer may already be released */ }
  scaleHandle._scaleStart = null;
  scaleHandle.dataset.pointerId = '';
  document.body.classList.remove('scaling');
  state.config.modelScale = state.modelScale;
  saveConfig();
  event.stopPropagation();
  event.preventDefault();
}

scaleHandle?.addEventListener('pointerup', finishScale);
scaleHandle?.addEventListener('pointercancel', finishScale);
$('#closeBubble').addEventListener('click', closeBubble);
$('#refreshButton').addEventListener('click', () => refreshData(true));

document.addEventListener('click', (event) => {
  const modelAction = event.target.closest('[data-model-action]');
  if (modelAction) {
    const action = state.actionOptions[Number(modelAction.dataset.modelAction)];
    if (action) {
      playAction(action);
      setGreeting('动作已切换。', `当前动作：${action.label}`);
    }
    return;
  }
  const menu = event.target.closest('[data-view]');
  if (menu) showDetail(menu.dataset.view);
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'back') showMenu();
  if (action === 'import-model') window.desktopAPI.openSettings();
  if (action === 'open-chat') window.desktopAPI?.openChatGPT();
  if (action === 'open-settings-window') window.desktopAPI?.openSettings();
  if (action === 'toggle-top') {
    state.config.alwaysOnTop = state.config.alwaysOnTop === false;
    saveConfig().then(() => renderSettings());
  }
  if (action === 'reset-model') window.desktopAPI.openSettings();
});

window.addEventListener('resize', () => {
  // Bubble dimensions are rigid and must not be derived from the desktop
  // window. The model remains within its own movable desktop surface.
  applyModelPosition();
  resizeLive2D();
});
let loadQueue = Promise.resolve(), requestedLoad = 0, loadedId = null;
function reportAnchor() {
  if (isBubbleSurface) return;
  const rect = petButton.getBoundingClientRect();
  let headY = rect.top + rect.height * .12;
  if (live2dModel) headY = rect.top + live2dModel.y - live2dNaturalSize.height * live2dModel.scale.y;
  void window.desktopAPI.reportAnchor({ x: rect.left + rect.width / 2, y: Math.max(0, headY) });
}
function applyChatStyle() {
  const c = state.config;
  document.body.dataset.theme = c.theme;
  bubble.style.borderRadius = c.bubbleRadius + 'px';
  const color = c.bubbleColor || '#f7faff';
  const rgb = [1,3,5].map(i => parseInt(color.slice(i,i+2),16));
  bubble.style.background = 'rgba(' + rgb.join(',') + ',' + c.bubbleOpacity + ')';
  bubble.style.boxShadow = c.bubbleShadow ? 'inset 0 0 0 1px #abc2da55, 0 3px 12px #17355622' : 'none';
  bubble.style.setProperty('--chat-font', (c.bubbleFontSize || 14) + 'px');
  applyBubbleFade();
}
async function syncModel(force = false) {
  const id = state.config.selectedModelId || '';
  if (!force && id === loadedId) return;
  const request = ++requestedLoad;
  loadQueue = loadQueue.catch(() => {}).then(async () => {
    if (request !== requestedLoad) return;
    disposeLive2D(); customImage.classList.remove('visible');
    state.actionOptions = []; renderActionPicker();
    petModel.classList.add('live2d-hidden');
    state.modelFileName = state.config.modelName || '尚未选择模型';
    state.modelMode = state.config.modelMode; state.modelPath = state.config.modelPath;
    if (!id) { loadedId = ''; if (!isBubbleSurface) setModelStatus('尚未选择模型 · 请在控制面板导入'); return; }
    try {
      const descriptor = await window.desktopAPI.modelDescriptor(id);
      if (request !== requestedLoad) return;
      if (isBubbleSurface) { setActionOptions(descriptor); loadedId = id; return; }
      if (descriptor.type === 'image') { customImage.src = descriptor.modelUrl; customImage.classList.add('visible'); setModelStatus('', false); }
      else await showLive2DModel(descriptor, false);
      loadedId = id; reportAnchor();
      if (state.config.bubbleDisplay === 'always') void window.desktopAPI.showBubble();
    } catch (error) { loadedId = null; setModelStatus(error.message, true); if (!isBubbleSurface) await window.desktopAPI.reportMotion({ ok:false, message:error.message }); else sourceStatus.textContent = error.message; }
  });
  return loadQueue;
}
function applyConfig(config) {
  state.config = config;
  applyDesktopBorder(config); applyLayoutLock(config); applyChatStyle();
  loadBubbleSize(config); loadBubblePosition(config); loadModelPosition(config);
  state.modelScale = config.modelScale || 1; updateModelScaleUI();
  scheduleRefresh(); reportAnchor();
  void syncModel();
}
window.desktopAPI.onConfigUpdated(config => { applyConfig(config); });
window.desktopAPI.onReloadModel(() => syncModel(true));
window.desktopAPI.onLibraryUpdated(() => { if (isBubbleSurface) void syncModel(true); });
window.desktopAPI.onPlayAction(({ action, loop }) => { void playAction(action, loop); });
window.desktopAPI.onStopAction(() => { motionManager.stop(); state.currentAction = null; renderActionPicker(); void window.desktopAPI.reportMotion({ ok:true, message:'已停止动作与表情' }); });
window.desktopAPI.onBubbleOpen(() => { bubble.classList.add('hidden'); openBubble(); });
window.desktopAPI.onMotionStatus(s => { if (isBubbleSurface) sourceStatus.textContent = s.message; });
window.addEventListener('resize', reportAnchor);
window.addEventListener('blur', () => { window.desktopAPI.endWindowDrag(); });
if (isBubbleSurface) {
  const setup = (element, resize) => {
    let pointer = null;
    element.addEventListener('pointerdown', e => {
      if (isLayoutLocked() || e.button !== 0) return;
      pointer = e.pointerId; element.setPointerCapture(pointer);
      if (resize) void window.desktopAPI.beginWindowResize('se'); else window.desktopAPI.beginWindowDrag();
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    element.addEventListener('pointermove', e => {
      if (e.pointerId !== pointer) return;
      if (resize) window.desktopAPI.resizeWindow({ cursorX: e.screenX, cursorY: e.screenY });
      e.stopImmediatePropagation();
    }, true);
    const finish = e => { if (pointer !== e.pointerId) return; pointer = null; if (resize) void window.desktopAPI.endWindowResize(); else window.desktopAPI.endWindowDrag(); e.stopImmediatePropagation(); };
    element.addEventListener('pointerup', finish, true); element.addEventListener('pointercancel', finish, true);
  };
  setup(bubbleTopline, false); setup(bubbleResizeHandle, true);
}
(async function init() {
  applyConfig(await window.desktopAPI.getConfig());
  await loadQueue;
  if (isBubbleSurface) openBubble();
  await refreshData(false);
})().catch(error => setModelStatus(error.message));
