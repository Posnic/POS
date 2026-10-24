'use strict';
const { EventEmitter } = require('events');
const net = require('net');
// Serial-compatible transport for documented text protocols over TCP/IP.
class ScaleTcpPort extends EventEmitter {
  constructor({host,tcpPort}) { super();this.host=host;this.tcpPort=tcpPort;this.path='tcp://'+host+':'+tcpPort;this.isOpen=false; }
  open(callback) {
    const socket=this.socket=new net.Socket();let answered=false;
    const finish=error=>{if(answered)return;answered=true;callback(error);};
    socket.on('data',data=>this.emit('data',data));
    socket.on('error',error=>{finish(error);this.emit('error',error);});
    socket.on('close',()=>{this.isOpen=false;finish(Error('Scale connection closed'));this.emit('close');});
    socket.connect(this.tcpPort,this.host,()=>{this.isOpen=true;socket.setNoDelay(true);this.emit('open');finish();});
  }
  write(data,callback) { this.socket.write(data,callback); }
  close(callback) { this.isOpen=false; if(!this.socket||this.socket.destroyed){if(callback)callback();return;} if(callback)this.socket.once('close',callback);this.socket.destroy(); }
}
module.exports={ScaleTcpPort};
