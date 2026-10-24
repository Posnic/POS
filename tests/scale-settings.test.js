const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
test('scale protocol settings restore and round-trip TCP and serial values',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/hardware-manager.html'),'utf8');const dom=new JSDOM(html,{runScripts:'outside-only'});try{
 const w=dom.window;w.ScaleProfiles=require('../src/scale-profiles');const select=w.document.getElementById('scaleProfile');w.ScaleProfiles.forEach(p=>select.add(new w.Option(p.name,p.id)));
 w.eval('var listPortsBtn=document.getElementById("listPortsBtn"),portsDropdownSection=document.getElementById("portsDropdownSection"),connectToPortBtn=document.getElementById("connectToPortBtn"),availablePorts=[],selectedPortPath="";'+html.slice(html.indexOf('        function scaleOptionsFromForm()'),html.indexOf('        const scaleProfileSelect')));
 for(const p of w.ScaleProfiles){w.restoreScaleOptions({...p.options,protocol:p.id,transport:'tcp',host:'192.168.1.5',tcpPort:4001});const saved=w.scaleOptionsFromForm();assert.equal(saved.protocol,p.id);assert.equal(saved.parity,p.options.parity);assert.equal(saved.pollHex,p.options.pollHex);assert.equal(saved.transport,'tcp');assert.equal(w.document.getElementById('scaleNetwork').classList.contains('hidden'),false);assert.equal(w.document.getElementById('scaleProfileNote').textContent,p.note);}
 w.restoreScaleOptions({transport:'serial'});assert.equal(w.document.getElementById('scaleNetwork').classList.contains('hidden'),true);
 }finally{dom.window.close();}
});
