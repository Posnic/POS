const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path'),{EventEmitter}=require('events');
const {normalizeScaleOptions}=require('../src/scale-options');
function fixture(fail=false) {
 const ports=[],messages=[];
 class Port extends EventEmitter {
  constructor(options){super();this.options=options;this.path=options.path;this.isOpen=false;ports.push(this);}
  open(cb){queueMicrotask(()=>{if(fail)return cb(Error('Access denied'));this.isOpen=true;this.emit('open');cb();});}
  close(cb){this.isOpen=false;this.emit('close');if(cb)cb();}
  write(data,cb){this.written=Buffer.from(data);if(cb)cb();}
 }
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/hardware-manager.js'),'utf8'),{module,exports:module.exports,Buffer,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,setInterval,clearInterval,require(id){if(id==='serialport')return {SerialPort:Port};if(id==='electron')return {BrowserWindow:{getAllWindows:()=>[{isDestroyed:()=>false,webContents:{send:(channel,data)=>messages.push(data)}}]},app:{}};if(id==='./scale-parser')return require('../src/scale-parser');if(id==='./scale-options')return require('../src/scale-options');if(id==='./scale-tcp-port')return require('../src/scale-tcp-port');if(id.startsWith('.'))return {};return require(id);}});
 return {manager:new module.exports.HardwareManager(),ports,messages};
}
test('settings object opens a real serial port and normalized settings survive startup',async()=>{
 const f=fixture();try{
  const result=await f.manager.autoConnectSaved({port:'COM7',options:{baudRate:2400,dataBits:7,parity:'even',unit:'g'}});
  assert.equal(result.success,true);assert.equal(f.ports.length,1);assert.equal(f.manager.currentPort.isMock,undefined);
  assert.equal(f.ports[0].options.baudRate,2400);assert.equal(f.ports[0].options.parity,'even');
  f.ports[0].emit('data',Buffer.from('ST,GS,375.0 g\r'));assert.equal(f.messages.at(-1).weight,.375);assert.equal(f.messages.at(-1).stable,true);
  f.manager.lastReadingAt=Date.now()-10000;f.manager.broadcastLastWeight();assert.equal(f.messages.at(-1).isValid,false);
 }finally{await f.manager.disconnectPort();}
});
test('opening failure is reported rather than claiming connected',async()=>{
 const f=fixture(true);const r=await f.manager.connectPort('COM7',{baudRate:9600});assert.equal(r.success,false);assert.match(r.error,/Access denied/);assert.equal(f.manager.isConnected(),false);await f.manager.disconnectPort();
});
test('changing ports closes the old reader and disconnect clears weight',async()=>{
 const f=fixture();try{
  await f.manager.connectPort('COM7');const old=f.ports[0];await f.manager.connectPort('COM8',{unit:'kg',integerDecimals:3,pollHex:'57 0D'});
  assert.equal(old.isOpen,false);assert.equal(f.manager.reconnectTimer,null);assert.equal(f.ports[1].written.toString('hex'),'570d');
  old.emit('data',Buffer.from('999 kg\r'));assert.equal(f.manager.lastWeight,null);
  f.ports[1].emit('data',Buffer.from('ST 00375\r'));assert.equal(f.manager.lastWeight,.375);
 }finally{await f.manager.disconnectPort();}assert.equal(f.messages.at(-1).isValid,false);assert.equal(f.manager.pollTimer,null);
});
test('concurrent connects cannot leave an orphaned serial port',async()=>{
 const f=fixture();try{const results=await Promise.all([f.manager.connectPort('COM1'),f.manager.connectPort('COM2')]);assert.equal(results[0].success,false);assert.equal(results[1].success,true);assert.equal(f.ports.filter(p=>p.isOpen).length,1);}finally{await f.manager.disconnectPort();}
});
test('simulation is explicit and invalid settings are refused',()=>{
 assert.equal(normalizeScaleOptions({baudRate:4800}).isMock,false);assert.equal(normalizeScaleOptions(true).isMock,true);
 for(const bad of [{baudRate:0},{parity:'bad'},{pollHex:'G1'},{pollHex:'1'},{idleMs:0},{frameLength:999},{maxKg:0}])assert.throws(()=>normalizeScaleOptions(bad));
});


test('unplug and reconnect retains nondefault baud rate and units',async()=>{
 const f=fixture();try{await f.manager.connectPort('COM7',{baudRate:4800,unit:'g'});f.ports[0].close();await new Promise(r=>setTimeout(r,1150));assert.equal(f.ports.length,2);assert.equal(f.ports[1].options.baudRate,4800);f.ports[1].emit('data',Buffer.from('ST 375 g\r'));assert.equal(f.manager.lastWeight,.375);}finally{await f.manager.disconnectPort();}
});
test('TCP text scale connects, sends the configured read request and decodes the reply',async()=>{
 const net=require('net');const f=fixture();let command='';const sockets=[];
 const server=net.createServer(socket=>{sockets.push(socket);socket.on('data',data=>{command+=data.toString();socket.write('S S 0.375 kg\r\n');});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const r=await f.manager.connectPort('tcp://127.0.0.1',{transport:'tcp',host:'127.0.0.1',tcpPort:server.address().port,protocol:'sics',pollHex:'53 49 0D 0A'});assert.equal(r.success,true);await new Promise(r=>setTimeout(r,80));assert.match(command,/SI/);assert.equal(f.manager.lastWeight,.375);assert.equal(f.manager.lastWeightStable,true);}
 finally{await f.manager.disconnectPort();sockets.forEach(s=>s.destroy());await new Promise(resolve=>server.close(resolve));}
});
