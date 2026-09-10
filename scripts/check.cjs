const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
function check(file) { execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' }); }
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (/\.(js|cjs)$/.test(file)) check(file); } }
check('main.js'); check('preload.js'); walk('src'); walk('scripts'); walk('tests');
for (const name of Object.keys(require('../package.json').dependencies)) console.log(`${name}: ${JSON.parse(fs.readFileSync(path.join('node_modules',name,'package.json'),'utf8')).version}`);
if (!fs.existsSync('runtime/live2dcubismcore.min.js')) throw new Error('Missing Cubism Core');
console.log('Syntax and required dependencies: PASS');
