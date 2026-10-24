const apiBrowser = require('../../../src/utils/chrome-executable').chromeExecutable;
const connectorBrowser =
  require('../../../../connectors/whatsapp/src/chrome-executable').chromeExecutable;

for (const chromeExecutable of [apiBrowser, connectorBrowser]) {
  test('uses the installed Puppeteer browser when its cache exists', () => {
    const result = chromeExecutable({
      platform: 'win32',
      env: { PATH: '', ProgramFiles: 'C:\\Program Files' },
      puppeteer: { executablePath: () => 'C:\\cache\\chrome.exe' },
      existsSync: (candidate) => candidate === 'C:\\cache\\chrome.exe',
    });
    expect(result).toBe('C:\\cache\\chrome.exe');
  });

  test('uses installed Chrome or Edge when the Puppeteer cache was not shipped', () => {
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const edge = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
    const options = {
      platform: 'win32',
      env: { PATH: '', ProgramFiles: 'C:\\Program Files' },
      puppeteer: { executablePath: () => 'C:\\missing\\chrome.exe' },
    };
    expect(chromeExecutable({ ...options, existsSync: (candidate) => candidate === chrome })).toBe(
      chrome
    );
    expect(chromeExecutable({ ...options, existsSync: (candidate) => candidate === edge })).toBe(
      edge
    );
  });

  test('honors an explicit browser path and reports an invalid one', () => {
    const options = {
      platform: 'win32',
      env: { CHROME_PATH: 'D:\\Browser\\chrome.exe', PATH: '' },
    };
    expect(chromeExecutable({ ...options, existsSync: () => true })).toBe(options.env.CHROME_PATH);
    expect(() => chromeExecutable({ ...options, existsSync: () => false })).toThrow(/CHROME_PATH/);
  });

  test('finds Chrome on Linux PATH and reports a useful error if none exists', () => {
    const options = { platform: 'linux', env: { PATH: '/opt/bin:/usr/local/bin' } };
    expect(
      chromeExecutable({ ...options, existsSync: (candidate) => candidate === '/opt/bin/chromium' })
    ).toBe('/opt/bin/chromium');
    expect(() => chromeExecutable({ ...options, existsSync: () => false })).toThrow(
      /Install one, or set CHROME_PATH/
    );
  });

  test('finds an installed macOS browser without a Puppeteer download', () => {
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    expect(
      chromeExecutable({
        platform: 'darwin',
        home: '/Users/shop',
        env: { PATH: '' },
        existsSync: (candidate) => candidate === edge,
      })
    ).toBe(edge);
  });
}
