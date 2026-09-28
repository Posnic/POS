'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { execFile } = require('node:child_process');
const run = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }, (e, out) =>
      e
        ? reject(
            Error(
              e.code === 'ENOENT'
                ? 'Speech engine unavailable. On Linux, install espeak-ng using your package manager.'
                : 'Speech generation failed. Check the installed voice.',
            ),
          )
        : resolve(out),
    ),
  );
async function synthesize(text, voice = '') {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000)
    throw Error('Invalid speech text.');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'posnic-voice-'));
  try {
    const input = path.join(dir, 'text.txt'),
      output = path.join(dir, 'voice.wav');
    await fs.writeFile(input, text, 'utf8');
    if (process.platform === 'win32') {
      await fs.writeFile(path.join(dir, 'voice.txt'), voice, 'utf8');
      const ps = `Add-Type -AssemblyName System.Speech\n$s=New-Object System.Speech.Synthesis.SpeechSynthesizer\ntry { $v=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'voice.txt')); if($v){try{$s.SelectVoice($v)}catch{ $match=$s.GetInstalledVoices() | Where-Object { $_.Enabled -and $v.StartsWith(($_.VoiceInfo.Name -replace ' Desktop$','')) } | Select-Object -First 1; if($match){$s.SelectVoice($match.VoiceInfo.Name)} }}; $s.SetOutputToWaveFile((Join-Path $PSScriptRoot 'voice.wav')); $s.Speak([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'text.txt'))) } finally {$s.Dispose()}`;
      const script = path.join(dir, 'say.ps1');
      await fs.writeFile(script, ps);
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script]);
    } else if (process.platform === 'darwin')
      await run('/usr/bin/say', [
        ...(voice ? ['-v', voice] : []),
        '-f',
        input,
        '-o',
        output,
        '--file-format=WAVE',
        '--data-format=LEI16@22050',
      ]);
    else await run('espeak-ng', ['-f', input, '-w', output, ...(voice ? ['-v', voice] : [])]);
    const audio = await fs.readFile(output);
    if (audio.length > 10000000) throw Error('Speech output is too large.');
    return 'data:audio/wav;base64,' + audio.toString('base64');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
async function voices() {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { @($s.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { @{name=$_.VoiceInfo.Name;lang=$_.VoiceInfo.Culture.Name} }) | ConvertTo-Json -Compress } finally {$s.Dispose()}',
    ]);
    const value = JSON.parse(out || '[]');
    return Array.isArray(value) ? value : [value];
  }
  if (process.platform === 'darwin')
    return (await run('/usr/bin/say', ['-v', '?'])).split('\n').flatMap((line) => {
      const m = line.match(/^(.+?)\s+([a-z]{2}[_-][A-Z]{2})\s+/);
      return m ? [{ name: m[1].trim(), lang: m[2] }] : [];
    });
  return (await run('espeak-ng', ['--voices']))
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const cols = line.trim().split(/\s+/);
      return cols.length >= 5 ? [{ name: cols[1], lang: cols[1] }] : [];
    });
}
module.exports = { synthesize, voices };
