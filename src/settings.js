const api = window.desktopAPI, $ = s => document.querySelector(s);
const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let config = {}, models = [], page = 'models', selected = '', query = '', filter = 'all', busy = false, loop = false;
const valueAt = key => key.split('.').reduce((a,k) => a?.[k], config);
const current = () => models.find(m => m.id === selected);
function notice(text, error = false) { $('#notice').textContent = text; $('#notice').classList.toggle('error', error); }
async function run(fn, message) {
  if (busy) return;
  busy = true;
  try { const result = await fn(); if (result?.errors?.length) notice(result.errors.join('\n'), true); else if (message) notice(message); return result; }
  catch (error) { notice(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true); }
  finally { busy = false; }
}
function confirmation(title, text, fn) {
  $('#confirmTitle').textContent = title; $('#confirmText').textContent = text;
  $('#confirmDialog').showModal(); $('#acceptConfirm').onclick = () => { $('#confirmDialog').close(); void run(fn); };
}
$('#cancelConfirm').onclick = () => $('#confirmDialog').close();
function render() {
  document.documentElement.dataset.theme = config.theme;
  $('#navigation').innerHTML = ControlPanel.menus.map(m => `<button data-page="${m.id}" class="${page === m.id ? 'active' : ''}"><span>${m.icon}</span>${m.label}</button>`).join('');
  const menu = ControlPanel.menus.find(m => m.id === page);
  $('#pageTitle').textContent = menu.label; $('#pageSubtitle').textContent = menu.subtitle;
  $('#libraryCount').textContent = `${models.length} 个模型`;
  $('#random').disabled = !models.length; $('#clear').disabled = !config.selectedModelId;
  if (page === 'models') renderModels(); else if (page === 'behavior') renderBehavior(); else if (ControlPanel.fields[page]) renderFields(); else menu.render?.($('#content'), config);
}
function summary(model) {
  if (!model) return `<section class="card model-detail"><span class="section-kicker">当前选择</span><div class="empty"><div class="empty-icon">◇</div><h2>还没有桌面伙伴</h2><p>导入完整模型包，开始你的<br>桌面陪伴体验。</p></div><button class="primary" data-do="import">导入模型入口</button><div class="button-row"><button data-do="directory">选择模型目录</button><button data-do="bundled">添加随附 Miku</button></div></section>`;
  return `<section class="card model-detail"><span class="section-kicker">${model.id === config.selectedModelId ? '正在使用' : '模型信息'}</span><div class="preview" id="preview"><div><span class="monogram">${escapeHTML(model.name.slice(0,1).toUpperCase())}</span><small>${model.type === 'live2d' ? 'Live2D · 桌面实时显示' : '静态图片'}</small></div></div><h2>${escapeHTML(model.name)}</h2><div class="tags"><span class="tag">${model.type === 'live2d' ? 'Cubism 3 / 4' : '图片'}</span><span class="tag">${model.actions.motions.length} 个动作</span><span class="tag">${model.actions.expressions.length} 个表情</span></div><code class="path">${escapeHTML(model.path)}</code>${model.warnings?.length ? `<p class="warnings">${model.warnings.map(escapeHTML).join('<br>')}</p>` : ''}<div class="button-row"><button class="primary" data-do="activate">${model.id === config.selectedModelId ? '显示桌宠' : '使用模型'}</button><button data-do="rescan">重新扫描</button><button data-do="reload">重新加载</button><button class="danger" data-do="remove">移出模型库</button></div></section>`;
}
function renderModels() {
  const visible = models.filter(m => (!query || m.name.toLowerCase().includes(query)) && (filter === 'all' || m.type === filter));
  $('#content').innerHTML = `<div class="columns">${summary(current())}<section class="card list-pane"><div class="list-header"><h3>模型库 <small>${visible.length}</small></h3><button class="primary" data-do="import">＋ 导入模型</button></div><div class="list">${visible.length ? visible.map(m => `<button class="model-row ${m.id === selected ? 'selected' : ''}" data-model="${m.id}"><span class="row-icon">◇</span><span class="row-copy"><b>${escapeHTML(m.name)}</b><small>${m.type === 'live2d' ? 'Live2D' : '静态图片'} · ${m.actions.motions.length} 动作 · ${m.actions.expressions.length} 表情</small></span><span>${m.id === config.selectedModelId ? '使用中' : '›'}</span></button>`).join('') : '<div class="empty"><div class="empty-icon">＋</div><h2>从一个模型开始</h2><p>支持选择入口文件或完整目录<br>也可以将文件夹拖放到这里</p><button data-do="directory">选择模型目录</button></div>'}</div><div class="drop-note">拖入模型目录 / .model3.json / .model / .moc3</div></section></div>`;
  const m = current(); if (m?.preview) api.modelDescriptor(m.id).then(d => { if (selected === m.id && $('#preview')) $('#preview').innerHTML = `<img src="${escapeHTML(d.previewUrl)}" alt="${escapeHTML(m.name)} 预览">`; }).catch(e => notice(e.message,true));
}
function actions(model) {
  return window.ActionCatalog.list(model);
}
let visibleActions = [];
function renderBehavior() {
  const model = models.find(m => m.id === config.selectedModelId);
  if (!model || model.type !== 'live2d') { $('#content').innerHTML = '<section class="card empty"><div class="empty-icon">▷</div><h2>尚无可用行为</h2><p>导入并使用 Live2D 模型后，这里会自动显示动作和表情。</p><button data-page="models">前往模型库</button></section>'; return; }
  selected = model.id;
  visibleActions = actions(model).filter(a => !query || `${a.label} ${a.category}`.toLowerCase().includes(query));
  const groups = [...new Set(visibleActions.map(a => a.category))];
  $('#content').innerHTML = `<div class="columns">${summary(model)}<section class="card list-pane"><div class="list-header"><h3>动作与表情</h3><label><input id="loopMotion" type="checkbox" ${loop ? 'checked' : ''}> 循环动作</label><button data-do="stop">停止</button></div><div class="list">${groups.length ? groups.map(g => `<div class="group-label">${escapeHTML(g)}</div>${visibleActions.map((a,i) => a.category === g ? `<div class="action-row"><span>${escapeHTML(a.label)}<small>${a.type === 'motion' ? '动作 · '+escapeHTML(a.group) : '表情'}</small></span><button data-action-index="${i}">播放</button></div>` : '').join('')}`).join('') : '<div class="empty">模型没有可用动作，或没有搜索匹配项</div>'}</div></section></div>`;
}
function renderFields() {
  $('#content').innerHTML = `<div class="settings-intro"><p>修改后自动保存${config.layoutLocked ? ' · 当前布局已锁定' : ''}</p><button data-do="${page === 'chat' ? 'bubble' : 'reset'}">${page === 'chat' ? '打开聊天框预览' : '恢复默认设置'}</button></div><div class="settings-grid">${ControlPanel.fields[page].map(section => `<section class="card"><h3>${section.title}</h3>${section.fields.map(f => {
    const [key,label,type,min,max,step] = f, value = valueAt(key), locked = config.layoutLocked && /^(modelScale|modelPosition|windowSize|bubbleSize|bubbleOffset)/.test(key);
    const attrs = `data-setting="${key}" ${locked ? 'disabled' : ''}`;
    const input = type === 'select' ? `<select ${attrs}>${min.map(([v,l])=>`<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<input ${attrs} type="${type}" ${type === 'checkbox' ? value ? 'checked' : '' : `value="${escapeHTML(value)}"`} ${typeof min === 'number' ? `min="${min}" max="${max}" step="${step || 1}"` : ''} ${type === 'url' ? 'placeholder="http://127.0.0.1:8765/status.json"' : ''}>`;
    return `<label class="field ${type === 'url' ? 'field-stack' : ''}"><span>${label}</span><div>${input}${type === 'range' ? `<output>${value}</output>` : ''}</div></label>`;
  }).join('')}</section>`).join('')}</div>`;
}
const operations = {
  import: () => api.pickModel('file'), directory: () => api.pickModel('directory'), bundled: () => api.addBundledModel(),
  activate: () => current()?.id === config.selectedModelId ? api.showAssistant() : api.selectModel(current()?.id),
  rescan: () => api.rescanModel(current()?.id), reload: async () => { if(current()?.id !== config.selectedModelId) await api.selectModel(current()?.id); return api.reloadModel(); }, stop: () => api.stopAction(), bubble: () => api.showBubble(),
  remove: () => confirmation('移出模型库', '仅移除模型库记录，保留原始模型文件。', () => api.removeModel(current().id)),
  reset: () => confirmation('恢复默认设置', '重置外观与布局选项，保留模型库及当前模型。', () => api.resetSettings())
};
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-page]'); if (nav) { page = nav.dataset.page; render(); return; }
  const model = e.target.closest('[data-model]'); if (model) { selected = model.dataset.model; render(); return; }
  const op = e.target.closest('[data-do]')?.dataset.do; if (operations[op]) void run(operations[op]);
  const action = e.target.closest('[data-action-index]'); if (action) { notice('正在加载动作…'); void run(() => api.playAction(visibleActions[Number(action.dataset.actionIndex)], loop)); }
});
document.addEventListener('input', e => { if (e.target.matches('[type=range]')) e.target.nextElementSibling.textContent = e.target.value; });
document.addEventListener('change', async e => {
  if (e.target.id === 'loopMotion') { loop = e.target.checked; return; }
  const key = e.target.dataset.setting; if (!key) return;
  if (!e.target.checkValidity()) { notice('请输入有效范围内的设置值', true); return; }
  const value = e.target.type === 'checkbox' ? e.target.checked : ['number','range'].includes(e.target.type) ? Number(e.target.value) : e.target.value;
  const [parent, child] = key.split('.'), patch = child ? { [parent]: { ...config[parent], [child]: value } } : { [parent]: value };
  // Settings changes are independent patches; never overwrite another window's newer state.
  try { config = await api.saveConfig(patch); notice('设置已保存'); render(); } catch (err) { notice(err.message,true); }
});
$('#searchForm').onsubmit = e => { e.preventDefault(); query = $('#search').value.trim().toLowerCase(); render(); };
$('#search').oninput = () => { query = $('#search').value.trim().toLowerCase(); render(); };
$('#filter').onchange = e => { filter = e.target.value; render(); };
$('#refresh').onclick = () => run(async () => { models = await api.listModels(); render(); }, '模型库已刷新');
$('#random').onclick = () => run(() => api.selectModel(models[Math.floor(Math.random()*models.length)].id));
$('#clear').onclick = () => run(() => api.selectModel(''));
$('#library').onclick = () => { page = 'models'; render(); notice('选择入口或目录导入；“移出模型库”不会删除源文件。'); run(() => api.openLibraryFolder()); };
$('#showPet').onclick = () => api.showAssistant(); $('#closePanel').onclick = () => api.closeSettings(); $('#quit').onclick = () => api.quitAssistant();
for (const name of ['dragenter','dragover']) document.addEventListener(name,e=>{e.preventDefault();document.body.classList.add('drag-over');});
document.addEventListener('dragleave', e=>{if(!e.relatedTarget)document.body.classList.remove('drag-over');});
document.addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('drag-over');const files=[...e.dataTransfer.files];run(async()=>{for(const file of files){const result=await api.importModel(api.getFilePath(file));if(result.errors.length)notice(result.errors.join('\n'),true);}});});
api.onConfigUpdated(c=>{config=c;selected=c.selectedModelId;render();});
api.onLibraryUpdated(list=>{models=list;if(!models.some(m=>m.id===selected))selected=config.selectedModelId;render();});
api.onMotionStatus(s=>notice(s.message,!s.ok));
(async()=>{[config,models]=await Promise.all([api.getConfig(),api.listModels()]);selected=config.selectedModelId;render();})().catch(e=>notice(e.message,true));
