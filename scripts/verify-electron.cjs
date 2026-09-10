const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const delay = ms => new Promise(r=>setTimeout(r,ms));
module.exports = async ctx => {
 const output=process.env.LDA_VERIFY_OUTPUT; fs.mkdirSync(output,{recursive:true});
 const results=[], errors=[];
 const evaluate=(win,code)=>win.webContents.executeJavaScript(code,true);
 const waitFor=async(fn,label)=>{const start=Date.now();while(Date.now()-start<45000){if(await fn())return;await delay(200);}throw new Error('Timeout: '+label);};
 const record=(name,value=true)=>{assert.ok(value,name);results.push({name,status:'pass'});console.log('PASS',name);};
 const capture=async(win,name)=>fs.writeFileSync(path.join(output,`${name}.png`),(await win.webContents.capturePage()).toPNG());
 try {
  const {mainWindow:pet,settingsWindow:panel}=ctx.getWindows();
  for(const win of [pet,panel]){win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});win.webContents.on('render-process-gone',(_e,d)=>errors.push('crash:'+d.reason));}
  await waitFor(()=>evaluate(panel,`Boolean(document.querySelector('[data-page="models"]'))`),'panel ready');
  panel.show();
  record('native control panel visible',panel.isVisible());
  if(ctx.readConfig().bubbleRadius===18) record('restart restores settings and selection',ctx.readConfig().bubbleSize.width===480 && ctx.readConfig().modelScale===1.1 && Boolean(ctx.readConfig().selectedModelId));
  record('contextIsolation / renderer Node disabled',await evaluate(panel,`typeof require==='undefined' && typeof process==='undefined'`));
  await evaluate(panel,`document.querySelector('[data-page="behavior"]').click()`);
  if(!ctx.readConfig().selectedModelId) record('empty behavior contains no action buttons',await evaluate(panel,`!document.querySelector('[data-action-index]') && document.body.innerText.includes('尚无可用行为')`));
  await capture(panel,'01-empty-behavior');
  await evaluate(panel,`document.querySelector('[data-page="models"]').click()`);
  await evaluate(panel,`window.desktopAPI.addBundledModel()`);
  await waitFor(()=>evaluate(pet,`typeof live2dModel !== 'undefined' && !!live2dModel && live2dCanvas.classList.contains('visible')`),'Live2D rendered');
  record('real Miku Cubism model rendered');
  await capture(panel,'02-model-library'); await capture(pet,'03-desktop-model');
  await evaluate(panel,`document.querySelector('[data-page="behavior"]').click()`);
  record('motion and expressions populated',await evaluate(panel,`document.querySelectorAll('[data-action-index]').length === 9`));
  await evaluate(panel,`document.querySelector('[data-action-index="0"]').click()`);
  await waitFor(()=>ctx.motionStatus().message.includes('已播放'),'motion acknowledgement'); record('panel motion playback acknowledged by renderer');
  const before=await evaluate(pet,`Array.from(live2dModel.internalModel.coreModel._parameterValues)`); await delay(800);
  const after=await evaluate(pet,`Array.from(live2dModel.internalModel.coreModel._parameterValues)`);
  record('Live2D parameters change across animation frames',before.some((v,i)=>Math.abs(v-after[i])>.001));
  await evaluate(panel,`window.desktopAPI.playAction({type:'expression',id:'脸红',label:'脸红'},false)`);
  await waitFor(()=>ctx.motionStatus().message.includes('脸红'),'expression acknowledgement'); record('expression playback');
  await evaluate(panel,`window.desktopAPI.playAction({type:'motion',group:'未分组',index:0,label:'Scene1'},true)`);
  await delay(6500);
  record('motion loop continues past two durations',await evaluate(pet,`!!motionManager.loop && motionManager.epoch >= 4`));
  await evaluate(panel,`window.desktopAPI.stopAction()`);await delay(200);
  record('stop clears motion and loop',await evaluate(pet,`motionManager.loop===null && live2dModel.internalModel.motionManager.isFinished()`));
  await capture(panel,'04-behavior');
  await evaluate(pet,`document.querySelector('#petButton').click()`);
  await waitFor(()=>ctx.getWindows().bubbleWindow?.isVisible(),'bubble opens');
  const bubble=ctx.getWindows().bubbleWindow; await delay(400);
  record('model click opens independent chat with model name',await evaluate(bubble,`!document.querySelector('#bubble').classList.contains('hidden') && document.body.innerText.includes('miku')`));
  await capture(bubble,'05-chat');
  await evaluate(panel,`window.desktopAPI.saveConfig({bubbleSize:{width:480,height:390},bubbleOffset:{x:-30,y:12},bubbleRadius:18,modelScale:1.1})`);
  await delay(250); const savedBounds=bubble.getBounds();
  await evaluate(bubble,`document.querySelector('#closeBubble').click()`);await delay(150);record('chat close hides native window',!bubble.isVisible());
  await evaluate(pet,`document.querySelector('#petButton').click()`);await delay(250);record('chat reopen restores size and position',JSON.stringify(savedBounds)===JSON.stringify(bubble.getBounds()));
  await evaluate(panel,`window.desktopAPI.saveConfig({layoutLocked:true})`);await delay(200);
  const size=ctx.readConfig().bubbleSize;
  await evaluate(panel,`window.desktopAPI.saveConfig({bubbleSize:{width:700,height:600},modelScale:1.4})`);
  record('locked layout rejects geometry changes',ctx.readConfig().bubbleSize.width===size.width && ctx.readConfig().modelScale===1.1 && !pet.isResizable());
  await evaluate(panel,`window.desktopAPI.saveConfig({layoutLocked:false})`);
  await evaluate(panel,`window.desktopAPI.reloadModel()`);await delay(500);
  await waitFor(()=>evaluate(pet,`!!live2dModel && live2dCanvas.isConnected && live2dCanvas.classList.contains('visible')`),'reload');record('model reload keeps canvas connected');
  for(const [width,height] of [[800,600],[1100,760]]) {
   panel.webContents.setZoomFactor(1);panel.setSize(width,height);await delay(200);
   await evaluate(panel,`document.querySelector('[data-page="options"]').click()`);
   record(`panel ${width}x${height} no page horizontal overflow`,await evaluate(panel,`document.documentElement.scrollWidth<=innerWidth && document.querySelector('#content').scrollWidth<=document.querySelector('#content').clientWidth`));
   await capture(panel,`06-options-${width}`);
  }
  record('configuration persisted to disk',JSON.parse(fs.readFileSync(path.join(ctx.app.getPath('userData'),'assistant-config.json'))).bubbleRadius===18);
  record('no renderer errors',errors.length===0);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({version:ctx.app.getVersion(),executable:process.execPath,profile:ctx.app.getPath('userData'),results,errors},null,2));
  console.log('VERIFICATION COMPLETE',output);
 } catch(error) { errors.push(error.stack);console.error(error);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors},null,2));ctx.app.exit(1);return; }
 if(process.env.LDA_VERIFY_KEEP_OPEN!=='1')ctx.app.quit();
};
