const fs = require('fs');
const path = require('path');
const SCHEMA_VERSION = 3;
const number = (v, fallback, min, max) => Number.isFinite(Number(v)) && v !== null ? Math.max(min, Math.min(max, Number(v))) : fallback;
const point = (v, fallback = { x: 0, y: 0 }) => ({ x: number(v?.x, fallback.x, -50000, 50000), y: number(v?.y, fallback.y, -50000, 50000) });
function defaults() {
  return { schemaVersion: SCHEMA_VERSION, alwaysOnTop: true, autoStart: false, showDesktopBorder: false,
    layoutLocked: false, opacity: 1, theme: 'light', refreshMinutes: 5, dataSourceMode: 'demo', bridgeUrl: '',
    modelName: '', modelMode: 'none', modelPath: '', selectedModelId: '', modelScale: 1, modelPosition: { x: 0, y: 0 },
    windowSize: { width: 460, height: 640 }, windowPosition: null,
    bubbleSize: { width: 422, height: 365 }, bubblePosition: { x: 19, y: 12 }, bubbleOffset: { x: 0, y: 0 },
    bubbleRadius: 24, bubbleOpacity: 0.97, bubbleColor: '#f7faff', bubbleShadow: true, bubbleFontSize: 14,
    bubbleFadeIn: true, bubbleFadeDuration: 280, bubbleDisplay: 'click' };
}
function normalize(raw = {}) {
  const d = defaults(), c = { ...d };
  for (const key of Object.keys(d)) if (Object.hasOwn(raw, key)) c[key] = raw[key];
  for (const key of ['alwaysOnTop', 'autoStart', 'showDesktopBorder', 'layoutLocked', 'bubbleShadow', 'bubbleFadeIn']) c[key] = typeof c[key] === 'boolean' ? c[key] : d[key];
  for (const [key, min, max] of [['opacity', .35, 1], ['modelScale', .65, 1.45], ['bubbleRadius', 0, 48], ['bubbleOpacity', .2, 1], ['bubbleFontSize', 11, 22], ['bubbleFadeDuration', 100, 1200], ['refreshMinutes', 1, 60]]) c[key] = number(c[key], d[key], min, max);
  c.windowSize = { width: Math.round(number(c.windowSize?.width, 460, 320, 2000)), height: Math.round(number(c.windowSize?.height, 640, 420, 2000)) };
  c.bubbleSize = { width: Math.round(number(c.bubbleSize?.width, 422, 300, 720)), height: Math.round(number(c.bubbleSize?.height, 365, 280, 640)) };
  for (const key of ['modelPosition', 'bubblePosition', 'bubbleOffset']) c[key] = point(c[key], d[key]);
  c.windowPosition = c.windowPosition ? point(c.windowPosition) : null;
  for (const key of ['modelName', 'modelPath', 'selectedModelId', 'bridgeUrl']) c[key] = typeof c[key] === 'string' ? c[key].slice(0, 4096) : d[key];
  c.modelMode = ['live2d', 'image', 'none'].includes(c.modelMode) ? c.modelMode : 'none';
  c.theme = c.theme === 'dark' ? 'dark' : 'light';
  c.dataSourceMode = c.dataSourceMode === 'bridge' ? 'bridge' : 'demo';
  c.bubbleDisplay = ['click', 'always', 'hidden'].includes(c.bubbleDisplay) ? c.bubbleDisplay : 'click';
  c.bubbleColor = /^#[0-9a-f]{6}$/i.test(c.bubbleColor) ? c.bubbleColor : d.bubbleColor;
  c.schemaVersion = SCHEMA_VERSION;
  return c;
}
function migrate(raw) {
  if (Number(raw?.schemaVersion) > SCHEMA_VERSION) throw new Error('配置来自更新版本，请使用相应版本打开；原文件已保留。');
  // v1 was flat and unversioned; v2 introduced library selection; v3 uses a screen-anchored bubble offset.
  return normalize(raw);
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}
class SettingsStore {
  constructor(file) {
    this.file = file;
    this.value = defaults();
    if (fs.existsSync(file)) {
      let raw;
      try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}.bak`); raw = {}; }
      this.value = migrate(raw);
      if (raw.schemaVersion !== SCHEMA_VERSION) fs.copyFileSync(file, `${file}.v${raw.schemaVersion || 1}-${Date.now()}.bak`);
    }
    atomicWrite(file, this.value);
  }
  read() { return structuredClone(this.value); }
  save(patch) { const next = normalize({ ...this.value, ...patch }); atomicWrite(this.file, next); this.value = next; return this.read(); }
  reset() { return this.save(defaults()); }
}
module.exports = { SettingsStore, defaults, normalize, migrate, atomicWrite };
