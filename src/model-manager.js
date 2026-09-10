const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWrite } = require('./settings-store');
const ENTRY = /\.(model3\.json|model|model\.json)$/i;
const IMAGE = /\.(png|webp|jpe?g)$/i;
const RESOURCE = /\.(json|moc3|png|webp|jpe?g|wav|mp3|ogg|model)$/i;
function inside(root, file) { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
function asset(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\x00-\x1f:#?]/.test(relative) || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`不安全的资源路径：${relative}`);
  const file = path.resolve(root, relative);
  if (!inside(root, file)) throw new Error(`资源路径越界：${relative}`);
  if (!fs.existsSync(file)) throw new Error(`缺少资源：${relative}`);
  const real = fs.realpathSync(file);
  if (!inside(root, real) || !fs.statSync(real).isFile() || !RESOURCE.test(real)) throw new Error(`资源不是安全的模型文件：${relative}`);
  return real;
}
function json(file) {
  if (fs.statSync(file).size > 32 * 1024 * 1024) throw new Error(`JSON 过大：${path.basename(file)}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error(`JSON 解析失败：${path.basename(file)}`); }
}
function walk(root) {
  const found = [];
  function visit(dir, depth) {
    if (depth > 12) throw new Error('模型目录层级过深');
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (found.length > 12000) throw new Error('模型包文件过多');
      const full = path.join(dir, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) visit(full, depth + 1);
      else if (item.isFile()) found.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  visit(root, 0); return found;
}
function scanModel(input) {
  let entry = fs.realpathSync(input);
  if (/\.moc3$/i.test(entry)) {
    const siblings = fs.readdirSync(path.dirname(entry)).filter(n => ENTRY.test(n));
    if (siblings.length !== 1) throw new Error('moc3 不能单独加载，请选择对应入口文件或完整模型目录');
    entry = path.join(path.dirname(entry), siblings[0]);
  }
  const root = fs.realpathSync(path.dirname(entry));
  if (IMAGE.test(entry)) return { path: entry, root, name: path.basename(entry, path.extname(entry)), type: 'image', preview: path.basename(entry), allowed: new Set([entry]), actions: { expressions: [], motions: [] }, warnings: [] };
  if (!ENTRY.test(entry)) throw new Error('请选择 .model3.json、兼容的 .model 入口、moc3 或模型目录');
  const model = json(entry), refs = model.FileReferences;
  if (!refs || !refs.Moc || !/\.moc3$/i.test(refs.Moc)) throw new Error('该入口不是 Cubism 3/4 模型；旧版 Cubism 2 .model 需要对应运行时，当前不支持播放');
  if (!Array.isArray(refs.Textures) || !refs.Textures.length) throw new Error('模型未声明纹理图片');
  const allowed = new Set([entry]), warnings = [], files = walk(root);
  function requireAsset(rel, kind) {
    const full = asset(root, rel); allowed.add(full);
    if (kind === 'json') json(full);
    return full;
  }
  const moc = requireAsset(refs.Moc);
  const fd = fs.openSync(moc, 'r'), header = Buffer.alloc(4);
  try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
  if (header.toString() !== 'MOC3') throw new Error('moc3 文件头无效');
  for (const tex of refs.Textures) { if (!IMAGE.test(tex)) throw new Error(`不支持的纹理格式：${tex}`); requireAsset(tex); }
  for (const key of ['Physics', 'Pose', 'DisplayInfo', 'UserData']) if (refs[key]) requireAsset(refs[key], 'json');
  const expressions = [], motions = {}, seenExpressions = new Set(), seenMotions = new Set();
  function addExpression(e) {
    if (!e || seenExpressions.has(e.File)) return;
    const file = requireAsset(e.File, 'json'), raw = json(file);
    if (!Array.isArray(raw.Parameters)) throw new Error(`表情缺少 Parameters：${e.File}`);
    seenExpressions.add(e.File); expressions.push({ Name: String(e.Name || path.basename(e.File).replace(/\.exp3\.json$/i, '')), File: e.File });
  }
  function addMotion(group, e) {
    if (!e || seenMotions.has(`${group}:${e.File}`)) return;
    const file = requireAsset(e.File, 'json'), raw = json(file);
    if (!raw.Meta || !Array.isArray(raw.Curves)) throw new Error(`动作缺少 Meta/Curves：${e.File}`);
    if (e.Sound) requireAsset(e.Sound);
    seenMotions.add(`${group}:${e.File}`); (motions[group] ||= []).push(e);
  }
  for (const e of refs.Expressions || []) addExpression(e);
  for (const [group, entries] of Object.entries(refs.Motions || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(group) || !Array.isArray(entries)) throw new Error('动作分组格式无效');
    for (const e of entries) addMotion(group, e);
  }
  for (const file of files) {
    try {
      if (/\.exp3\.json$/i.test(file)) addExpression({ File: file });
      if (/\.motion3\.json$/i.test(file) && !Object.values(motions).flat().some(e => e.File === file)) addMotion(path.posix.dirname(file) === '.' ? '未分组' : path.posix.dirname(file), { File: file });
    } catch (error) { warnings.push(error.message); }
  }
  refs.Expressions = expressions; refs.Motions = motions;
  const preview = files.find(f => /(^|\/)(preview|thumbnail|icon)\.(png|webp|jpe?g)$/i.test(f)) || '';
  if (preview) requireAsset(preview);
  return { path: entry, root, name: path.basename(entry).replace(/\.(model3\.json|model\.json|model)$/i, ''), type: 'live2d', model, allowed, preview, warnings,
    actions: { expressions, motions: Object.entries(motions).flatMap(([group, entries]) => entries.map((e, index) => ({ group, index, file: e.File, name: path.posix.basename(e.File).replace(/\.motion3\.json$/i, '') }))) } };
}
class ModelManager {
  constructor(file) {
    this.file = file; this.sources = new Map(); this.library = [];
    if (fs.existsSync(file)) {
      try { const raw = json(file); if (!Array.isArray(raw.models)) throw new Error(); this.library = raw.models.filter(m => typeof m.path === 'string' && typeof m.id === 'string'); }
      catch { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}.bak`); }
    }
  }
  save() { atomicWrite(this.file, { schemaVersion: 1, models: this.library }); }
  list() { return structuredClone(this.library); }
  import(input) {
    const full = fs.realpathSync(input);
    const candidates = fs.statSync(full).isDirectory() ? walk(full).filter(f => ENTRY.test(f)).map(f => path.join(full, f)) : [full];
    if (!candidates.length) throw new Error('目录内没有模型入口；请保留完整模型包及入口文件');
    const imported = [], errors = [];
    for (const candidate of candidates) {
      try {
        const scan = scanModel(candidate), old = this.library.find(m => m.path.toLowerCase() === scan.path.toLowerCase());
        const meta = { id: old?.id || crypto.randomUUID(), bundled: old?.bundled, name: scan.name, path: scan.path, type: scan.type, preview: scan.preview, actions: scan.actions, warnings: scan.warnings, scannedAt: new Date().toISOString() };
        this.library = this.library.filter(m => m.id !== meta.id); this.library.push(meta); imported.push(meta);
      } catch (error) { errors.push(`${path.basename(candidate)}：${error.message}`); }
    }
    if (!imported.length) throw new Error(errors.join('\n'));
    this.save(); return { imported, errors };
  }
  get(id) { const model = this.library.find(m => m.id === id); if (!model) throw new Error('模型不在模型库中'); return model; }
  remove(id) { this.get(id); this.library = this.library.filter(m => m.id !== id); this.sources.delete(id); this.save(); }
  descriptor(id) {
    const meta = this.get(id), scan = scanModel(meta.path);
    this.sources.set(id, scan);
    const url = file => `live2d://${id}/${file.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
    return { ...meta, modelPath: scan.path, modelName: scan.name, modelUrl: url(path.basename(scan.path)), previewUrl: scan.preview ? url(scan.preview) : '', actions: scan.actions, warnings: scan.warnings };
  }
  async serve(request) {
    try {
      const url = new URL(request.url), source = this.sources.get(url.hostname);
      if (!source) return new Response('Unknown model', { status: 404 });
      const relative = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const file = asset(source.root, relative);
      if (!source.allowed.has(file)) return new Response('Asset not allowed', { status: 403 });
      if (file === source.path && source.model) return Response.json(source.model);
      const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' }[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(await fs.promises.readFile(file), { headers: { 'content-type': type, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('Invalid model asset', { status: 404 }); }
  }
}
module.exports = { ModelManager, scanModel, asset, inside };
