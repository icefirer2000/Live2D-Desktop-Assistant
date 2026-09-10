(function (root) {
  const types = new Map();
  types.set('motion', meta => (meta.actions?.motions || []).map(m => ({ type: 'motion', group: m.group, index: m.index, label: m.name || m.file, category: m.group })));
  types.set('expression', meta => (meta.actions?.expressions || []).map(e => ({ type: 'expression', id: e.Name, label: e.Name, category: '表情' })));
  const catalog = {
    register(type, list) { types.set(type, list); },
    list(meta) { return [...types.values()].flatMap(list => list(meta)); },
    resolve(meta, requested) {
      return this.list(meta).find(action => Object.entries(action).filter(([key]) => !['label', 'category'].includes(key)).every(([key,value]) => requested?.[key] === value));
    }
  };
  if (typeof module !== 'undefined') module.exports = catalog;
  else root.ActionCatalog = catalog;
})(globalThis);
