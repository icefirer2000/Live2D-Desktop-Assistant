const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), os = require('os');
const { SettingsStore, migrate } = require('../src/settings-store');
const { scanModel, ModelManager, asset } = require('../src/model-manager');
const { clampBounds, bubbleBounds } = require('../src/layout-manager');
const { responsiveScale } = require('../src/responsive-scale');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lda-test-'));
test('migration, validation, partial saves and restart persistence', () => {
 const dir=temp(), file=path.join(dir,'config.json');
 fs.writeFileSync(file,JSON.stringify({ modelPath:'D:/my.model3.json',modelMode:'live2d',bubbleSize:{width:500,height:400},modelScale:1.2 }));
 const store=new SettingsStore(file); assert.equal(store.read().schemaVersion,3); assert.equal(store.read().modelPath,'D:/my.model3.json');
 store.save({opacity:99,windowSize:{width:Infinity,height:-3},bubbleColor:'url(bad)',bubbleOffset:{x:-20,y:30}});
 const again=new SettingsStore(file).read(); assert.equal(again.opacity,1); assert.equal(again.windowSize.height,420); assert.equal(again.bubbleColor,'#f7faff'); assert.deepEqual(again.bubbleOffset,{x:-20,y:30}); assert.equal(again.bubbleSize.width,500);
 assert.throws(()=>migrate({schemaVersion:99}),/更新版本/);
});
test('corrupt config is backed up and defaults contain no fake model',()=>{
 const dir=temp(), file=path.join(dir,'config.json'); fs.writeFileSync(file,'oops');
 const store=new SettingsStore(file); assert.equal(store.read().modelMode,'none'); assert.equal(store.read().modelPath,''); assert.ok(fs.readdirSync(dir).some(f=>f.includes('corrupt')));
});
test('bundled model discovers unlisted expressions and motion; remove preserves assets',()=>{
 const file=path.resolve('miku/miku.model3.json'), scan=scanModel(file); assert.equal(scan.actions.expressions.length,8); assert.equal(scan.actions.motions.length,1);
 const manager=new ModelManager(path.join(temp(),'library.json')); const id=manager.import(file).imported[0].id;
 assert.equal(manager.import(file).imported[0].id,id); assert.equal(manager.list().length,1); manager.remove(id); assert.ok(fs.existsSync(file));
});
test('resource path traversal, absolute paths and undeclared scripts are denied',async()=>{
 const root=fs.realpathSync('miku');
 for(const relative of ['../main.js','..\\main.js','C:/Windows/win.ini','https://x/a','miku.model3.json?x']) assert.throws(()=>asset(root,relative));
 const manager=new ModelManager(path.join(temp(),'library.json')), id=manager.import(root).imported[0].id;
 manager.descriptor(id); assert.equal((await manager.serve(new Request(`live2d://${id}/模型使用说明.txt`))).status,404);
 assert.equal((await manager.serve(new Request(`live2d://${id}/items_pinned_to_model.json`))).status,403);
 assert.equal((await manager.serve(new Request(`live2d://${id}/miku.model3.json`))).status,200);
});
test('missing texture and malformed declared motion fail with actionable errors',()=>{
 const dir=temp(); fs.writeFileSync(path.join(dir,'bad.moc3'),'MOC3');
 const entry=path.join(dir,'bad.model3.json'); fs.writeFileSync(entry,JSON.stringify({FileReferences:{Moc:'bad.moc3',Textures:['missing.png']}}));
 assert.throws(()=>scanModel(entry),/缺少资源/);
 fs.writeFileSync(path.join(dir,'missing.png'),'test');fs.writeFileSync(path.join(dir,'bad.motion3.json'),'bad');
 fs.writeFileSync(entry,JSON.stringify({FileReferences:{Moc:'bad.moc3',Textures:['missing.png'],Motions:{Test:[{File:'bad.motion3.json'}]}}}));assert.throws(()=>scanModel(entry),/JSON 解析失败/);
});
test('negative monitor coordinates, work areas and DPI scaling remain bounded',()=>{
 for (const area of [{x:0,y:0,width:1280,height:680},{x:-1920,y:0,width:1920,height:1040},{x:0,y:0,width:2560,height:1400}]) {
  const scale=responsiveScale({workArea:area,scaleFactor:2}); const b=bubbleBounds({x:area.x+10,y:20},{width:720,height:640},{x:-900,y:-900},area,scale);
  assert.ok(b.x>=area.x && b.y>=area.y && b.x+b.width<=area.x+area.width && b.y+b.height<=area.y+area.height);
 }
 assert.deepEqual(clampBounds({x:-999,y:999,width:5000,height:5000},{x:0,y:0,width:800,height:600}),{x:0,y:0,width:800,height:600});
 assert.equal(responsiveScale({workArea:{width:1920,height:1080},scaleFactor:2}),1);
});
test('junction escaping a model root is rejected after realpath',()=>{
 const root=temp(), external=temp();fs.writeFileSync(path.join(external,'secret.json'),'{}');
 fs.symlinkSync(external,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
 assert.throws(()=>asset(fs.realpathSync(root),'linked/secret.json'),/安全的模型文件/);
});
test('action catalog validates canonical action identity and supports registered types',()=>{
 const catalog=require('../src/action-catalog'),meta={actions:{motions:[{group:'Idle',index:0,file:'idle.motion3.json'}],expressions:[]}};
 assert.ok(catalog.resolve(meta,{type:'motion',group:'Idle',index:0}));assert.equal(catalog.resolve(meta,{type:'motion',group:'Idle',index:10}),undefined);
 catalog.register('test',()=>[{type:'test',id:'test-action',label:'Test'}]);assert.ok(catalog.resolve(meta,{type:'test',id:'test-action'}));
});
