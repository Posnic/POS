// Rebuild the browser QR encoder from the API's installed, locked qrcode dependency.
const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');const files=[],ids=new Map();
function add(file){if(ids.has(file))return ids.get(file);const id=files.length;ids.set(file,id);files.push('');const code=fs.readFileSync(file,'utf8').replace(/require\(['"]([^'"]+)['"]\)/g,(_,name)=>'require('+add(require.resolve(name,{paths:[path.dirname(file)]}))+')');files[id]='function(module,exports,require){\n'+code+'\n}';return id;}
const entry=add(require.resolve('qrcode/lib/core/qrcode',{paths:[path.join(root,'api')]}));
const license=['qrcode','dijkstrajs'].map(name=>name+'\n'+fs.readFileSync(path.join(root,'api/node_modules',name,name === 'dijkstrajs' ? 'LICENSE.md' : 'LICENSE'),'utf8')).join('\n\n');
fs.mkdirSync(path.join(root,'frontend/static/script/js/vendor'),{recursive:true});
fs.writeFileSync(path.join(root,'frontend/static/script/js/vendor/label-qr.js'),'/* Bundled qrcode 1.5.4 and dijkstrajs. MIT licences: label-qr.LICENSE.txt. Rebuild: node scripts/build-label-qr.cjs */\n(function(root){var modules=['+files.join(',')+'];var cache={};function load(id){if(cache[id])return cache[id].exports;var m=cache[id]={exports:{}};modules[id](m,m.exports,load);return m.exports;}root.PosnicLabelQR=load('+entry+');})(typeof window!=="undefined"?window:globalThis);\n');
fs.writeFileSync(path.join(root,'frontend/static/script/js/vendor/label-qr.LICENSE.txt'),license);
