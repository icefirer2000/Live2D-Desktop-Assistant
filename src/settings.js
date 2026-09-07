const settingsState = { config: {} };
const $ = (selector) => document.querySelector(selector);
const modelName = $('#modelName');
const opacity = $('#opacity');
const opacityValue = $('#opacityValue');
const alwaysOnTop = $('#alwaysOnTop');
const refreshMinutes = $('#refreshMinutes');
const dataSourceMode = $('#dataSourceMode');
const bridgeUrl = $('#bridgeUrl');
const savedState = $('#savedState');
const showDesktopBorder = $('#showDesktopBorder');
const layoutLocked = $('#layoutLocked');
const bubbleFadeIn = $('#bubbleFadeIn');
const bubbleFadeDuration = $('#bubbleFadeDuration');
const bubbleFadeDurationValue = $('#bubbleFadeDurationValue');
const bubbleFadeDurationRow = $('#bubbleFadeDurationRow');
let displaySaveTimer = null;
let bubbleFadeSaveTimer = null;

function updateOpacityLabel() { opacityValue.textContent = `${Math.round(Number(opacity.value || 1) * 100)}%`; }
function updateBubbleFadeUI() {
  const enabled = bubbleFadeIn.checked;
  bubbleFadeDurationRow.hidden = !enabled;
  bubbleFadeDurationValue.textContent = `${Math.round(Number(bubbleFadeDuration.value || 280))} ms`;
}
function loadConfig(config) {
  settingsState.config = { ...config };
  modelName.value = config.modelName || 'Codey · 内置演示模型';
  opacity.value = Number(config.opacity || 1);
  alwaysOnTop.checked = config.alwaysOnTop !== false;
  showDesktopBorder.checked = config.showDesktopBorder === true;
  layoutLocked.checked = config.layoutLocked === true;
  bubbleFadeIn.checked = config.bubbleFadeIn === true;
  bubbleFadeDuration.value = Number(config.bubbleFadeDuration || 280);
  refreshMinutes.value = String(config.refreshMinutes || 5);
  dataSourceMode.value = config.dataSourceMode || 'demo';
  bridgeUrl.value = config.bridgeUrl || '';
  updateOpacityLabel();
  updateBubbleFadeUI();
}
async function save() {
  if (settingsState.config.modelMode === 'live2d' && !settingsState.config.modelPath) {
    savedState.textContent = '请重新选择 .model3.json';
    return;
  }
  settingsState.config = { ...settingsState.config, modelName: modelName.value, modelMode: settingsState.config.modelMode || 'fallback', opacity: Number(opacity.value), alwaysOnTop: alwaysOnTop.checked, showDesktopBorder: showDesktopBorder.checked, layoutLocked: layoutLocked.checked, bubbleFadeIn: bubbleFadeIn.checked, bubbleFadeDuration: Number(bubbleFadeDuration.value), refreshMinutes: Number(refreshMinutes.value), dataSourceMode: dataSourceMode.value, bridgeUrl: bridgeUrl.value.trim() };
  if (settingsState.config.dataSourceMode === 'bridge' && !settingsState.config.bridgeUrl) {
    savedState.textContent = '请输入本地桥接 JSON 地址';
    return;
  }
  if (window.desktopAPI) {
    const saved = await window.desktopAPI.saveConfig(settingsState.config);
    if (saved) loadConfig(saved);
  }
  savedState.textContent = `已保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}
async function saveBorderPreference() {
  if (!window.desktopAPI) return;
  const saved = await window.desktopAPI.saveConfig({ ...settingsState.config, showDesktopBorder: showDesktopBorder.checked });
  if (saved) loadConfig(saved);
  savedState.textContent = showDesktopBorder.checked ? '可见边框已开启' : '可见边框已关闭';
}
async function saveLayoutLockPreference() {
  if (!window.desktopAPI) return;
  const saved = await window.desktopAPI.saveConfig({ ...settingsState.config, layoutLocked: layoutLocked.checked });
  if (saved) loadConfig(saved);
  savedState.textContent = layoutLocked.checked ? '桌宠布局已锁定：可整体拖动' : '桌宠布局已解锁：可分别调整';
}

async function saveDisplayPreference(status = '') {
  if (!window.desktopAPI) return;
  settingsState.config = {
    ...settingsState.config,
    opacity: Number(opacity.value),
    alwaysOnTop: alwaysOnTop.checked
  };
  const saved = await window.desktopAPI.saveConfig(settingsState.config);
  if (saved) loadConfig(saved);
  savedState.textContent = status || `显示设置已应用 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

function queueDisplayPreferenceSave() {
  window.clearTimeout(displaySaveTimer);
  displaySaveTimer = window.setTimeout(() => { void saveDisplayPreference(); }, 160);
}

async function saveBubbleFadePreference(status = '') {
  if (!window.desktopAPI) return;
  settingsState.config = {
    ...settingsState.config,
    bubbleFadeIn: bubbleFadeIn.checked,
    bubbleFadeDuration: Number(bubbleFadeDuration.value)
  };
  const saved = await window.desktopAPI.saveConfig(settingsState.config);
  if (saved) loadConfig(saved);
  savedState.textContent = status || '聊天框动效已应用';
}

function queueBubbleFadeDurationSave() {
  window.clearTimeout(bubbleFadeSaveTimer);
  bubbleFadeSaveTimer = window.setTimeout(() => { void saveBubbleFadePreference(); }, 160);
}

opacity.addEventListener('input', () => {
  updateOpacityLabel();
  queueDisplayPreferenceSave();
});
opacity.addEventListener('change', () => { void saveDisplayPreference(); });
alwaysOnTop.addEventListener('change', () => {
  void saveDisplayPreference(alwaysOnTop.checked ? '已开启始终置顶' : '已关闭始终置顶');
});
showDesktopBorder.addEventListener('change', () => { void saveBorderPreference(); });
layoutLocked.addEventListener('change', () => { void saveLayoutLockPreference(); });
bubbleFadeIn.addEventListener('change', () => {
  updateBubbleFadeUI();
  void saveBubbleFadePreference(bubbleFadeIn.checked ? '聊天框淡入已开启' : '聊天框淡入已关闭');
});
bubbleFadeDuration.addEventListener('input', () => {
  updateBubbleFadeUI();
  if (bubbleFadeIn.checked) queueBubbleFadeDurationSave();
});
bubbleFadeDuration.addEventListener('change', () => {
  if (bubbleFadeIn.checked) void saveBubbleFadePreference();
});
$('#closeButton').addEventListener('click', () => { window.desktopAPI?.closeSettings(); });
$('#laterButton').addEventListener('click', () => { window.desktopAPI?.closeSettings(); });
$('#saveButton').addEventListener('click', save);
$('#importButton').addEventListener('click', () => $('#modelFile').click());
$('#modelFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (/\.model3\.json$/i.test(file.name)) {
    try {
      const filePath = window.desktopAPI?.getFilePath(file);
      if (!filePath) throw new Error('无法读取模型路径');
      const descriptor = await window.desktopAPI.loadLive2DModel(filePath);
      modelName.value = descriptor.modelName;
      settingsState.config.modelMode = 'live2d';
      settingsState.config.modelPath = descriptor.modelPath;
      savedState.textContent = 'Live2D 模型已选择 · 点击保存并开始';
    } catch (error) {
      savedState.textContent = error.message || 'Live2D 模型选择失败';
    }
  } else {
    modelName.value = file.name.replace(/\.[^.]+$/, '');
    settingsState.config.modelMode = file.type.startsWith('image/') ? 'image' : 'model-package';
    delete settingsState.config.modelPath;
    savedState.textContent = '模型已选择 · 点击保存';
  }
  event.target.value = '';
});
window.desktopAPI?.onConfigUpdated?.((config) => {
  loadConfig(config || {});
  savedState.textContent = '设置已从桌面同步';
});
(async () => { loadConfig(window.desktopAPI ? await window.desktopAPI.getConfig() : {}); })();
