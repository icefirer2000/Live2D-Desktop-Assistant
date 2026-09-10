const settingsState = { config: {} };
const $ = (selector) => document.querySelector(selector);
const modelName = $('#modelName');
const opacity = $('#opacity');
const opacityValue = $('#opacityValue');
const alwaysOnTop = $('#alwaysOnTop');
const refreshMinutes = $('#refreshMinutes');
const savedState = $('#savedState');
const showDesktopBorder = $('#showDesktopBorder');

function updateOpacityLabel() { opacityValue.textContent = `${Math.round(Number(opacity.value || 1) * 100)}%`; }
function loadConfig(config) {
  settingsState.config = { ...config };
  modelName.value = config.modelName || 'Codey · 内置演示模型';
  opacity.value = Number(config.opacity || 1);
  alwaysOnTop.checked = config.alwaysOnTop !== false;
  showDesktopBorder.checked = config.showDesktopBorder === true;
  refreshMinutes.value = String(config.refreshMinutes || 5);
  updateOpacityLabel();
}
async function save() {
  if (settingsState.config.modelMode === 'live2d' && !settingsState.config.modelPath) {
    savedState.textContent = '请重新选择 .model3.json';
    return;
  }
  settingsState.config = { ...settingsState.config, modelName: modelName.value, modelMode: settingsState.config.modelMode || 'fallback', opacity: Number(opacity.value), alwaysOnTop: alwaysOnTop.checked, showDesktopBorder: showDesktopBorder.checked, refreshMinutes: Number(refreshMinutes.value) };
  if (window.desktopAPI) await window.desktopAPI.saveConfig(settingsState.config);
  savedState.textContent = `已保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}
async function saveBorderPreference() {
  if (!window.desktopAPI) return;
  const saved = await window.desktopAPI.saveConfig({ ...settingsState.config, showDesktopBorder: showDesktopBorder.checked });
  if (saved) loadConfig(saved);
  savedState.textContent = showDesktopBorder.checked ? '可见边框已开启' : '可见边框已关闭';
}
opacity.addEventListener('input', updateOpacityLabel);
showDesktopBorder.addEventListener('change', () => { void saveBorderPreference(); });
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
