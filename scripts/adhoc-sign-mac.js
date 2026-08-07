'use strict';
/*
 * Give the macOS build a signature, even though we have no certificate.
 *
 * A Mac user reported that Posnic "is damaged and can't be opened". That
 * message is not about a corrupted download and no amount of re-downloading
 * fixes it. On Apple Silicon every executable must carry a signature - even a
 * meaningless one - and macOS refuses an unsigned binary outright rather than
 * offering the usual "unidentified developer" dialog. So the app was
 * unopenable, and the advice on the download page (right-click, Open) could
 * not work, because that path is only offered for apps that are signed by
 * somebody untrusted rather than not signed at all.
 *
 * An ad-hoc signature - `codesign --sign -` - costs nothing, needs no Apple
 * account, and moves the app from "damaged, throw it away" to "unidentified
 * developer, open it if you meant to". That is the whole difference between a
 * build a shop can install and one they cannot.
 *
 * It is not notarization and does not pretend to be. Once there is a Developer
 * ID certificate this hook should give way to real signing plus notarization,
 * which removes the warning entirely. Until then this is the difference
 * between a beta people can try and a beta that looks broken.
 *
 * Ordering matters: --deep signs nested code first and the outer bundle last,
 * because signing the outer bundle seals the contents and anything signed
 * afterwards invalidates that seal.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function adhocSignMac(context) {
  const platform = context.electronPlatformName
    || (context.packager && context.packager.platform && context.packager.platform.name);

  if (platform !== 'darwin' && platform !== 'mac') return;

  /* If a real identity was configured, electron-builder has already signed
     this properly and re-signing ad-hoc would replace a good signature with a
     worthless one. */
  const configured = context.packager
    && context.packager.config
    && context.packager.config.mac
    && context.packager.config.mac.identity;
  if (configured) {
    console.log('[mac] A signing identity is configured; leaving the signature alone');
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  if (!fs.existsSync(appPath)) {
    console.warn(`[mac] ${appPath} not found; nothing to sign`);
    return;
  }

  try {
    execFileSync(
      'codesign',
      ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
      { stdio: 'inherit' },
    );

    /* Say what actually happened rather than assuming it worked. An
       "adhoc" flag in the output is the proof. */
    const info = execFileSync('codesign', ['-dv', appPath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      + execFileSync('codesign', ['-dv', appPath], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(`[mac] Ad-hoc signed ${appName}${/adhoc/i.test(info) ? ' (verified adhoc)' : ''}`);
  } catch (e) {
    /*
     * Do not fail the build. An unsigned mac build is what we shipped before
     * this existed, so the worst case is the previous behaviour - and a
     * Windows or Linux release should not be lost because a mac runner did not
     * have codesign.
     */
    console.warn('[mac] Ad-hoc signing failed; the build will be unsigned:', e.message);
  }
};
