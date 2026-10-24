(function (root) {
  const profiles = [
    { id: 'generic', name: 'Generic / custom text scale', note: 'Continuous or Print-key text output. Confirm units and serial settings against the scale manual.', options: { baudRate:9600,dataBits:8,parity:'none',stopBits:1,unit:'auto',pollHex:'',stableFrames:5 } },
    { id: 'and', name: 'A&D standard ST/US protocol', note: 'For A&D devices configured for standard ST/US output and Q queries. Serial settings vary by model; this preset uses the documented EK-W 2400 / 7-E-1 format.', options: { baudRate:2400,dataBits:7,parity:'even',stopBits:1,unit:'g',pollHex:'51 0D 0A',pollIntervalMs:1000,stableFrames:5 } },
    { id: 'sics', name: 'Mettler Toledo MT-SICS', note: 'Only devices with MT-SICS enabled. Requests immediate weight using SI; dynamic responses are not used for automatic billing.', options: { baudRate:9600,dataBits:8,parity:'none',stopBits:1,unit:'kg',pollHex:'53 49 0D 0A',pollIntervalMs:1000,stableFrames:5 } },
    { id: 'ohaus', name: 'OHAUS PR / compatible SP command', note: 'Only models documenting SP (stable print). Use weight-only output and match the serial settings configured on the balance.', options: { baudRate:9600,dataBits:8,parity:'none',stopBits:1,unit:'g',pollHex:'53 50 0D 0A',pollIntervalMs:1000,stableFrames:1 } },
    { id: 'stream', name: 'Unit-tagged text stream (kg / g / lb / oz)', note: 'For scales configured for a single weight line with a unit. No commands are sent. Select the correct baud rate on both devices.', options: { baudRate:9600,dataBits:8,parity:'none',stopBits:1,unit:'auto',pollHex:'',stableFrames:5 } }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = profiles;
  else root.ScaleProfiles = profiles;
})(typeof window !== 'undefined' ? window : globalThis);
