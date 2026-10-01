'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readEvidence } = require('../../../scripts/ask-posnic-evidence');

describe('bounded recovery evidence file', () => {
  let directory, file;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-posnic-evidence-'));
    file = path.join(directory, 'evidence.json');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(directory);
  });

  test('uses one open descriptor for inspection and reading, and closes it', () => {
    fs.writeFileSync(file, '{"provider":"synthetic"}');
    const opened = jest.spyOn(fs, 'openSync'),
      inspected = jest.spyOn(fs, 'fstatSync'),
      read = jest.spyOn(fs, 'readSync'),
      closed = jest.spyOn(fs, 'closeSync');
    expect(readEvidence(file)).toEqual({ provider: 'synthetic' });
    expect(opened).toHaveBeenCalledTimes(1);
    const fd = opened.mock.results[0].value;
    expect(inspected).toHaveBeenCalledWith(fd);
    expect(read.mock.calls.every((call) => call[0] === fd)).toBe(true);
    expect(closed).toHaveBeenCalledWith(fd);
  });

  test('growth after inspection cannot exceed the bounded read', () => {
    fs.writeFileSync(file, 'x'.repeat(100000));
    jest.spyOn(fs, 'fstatSync').mockReturnValue({ isFile: () => true, size: 1 });
    const read = jest.spyOn(fs, 'readSync'),
      closed = jest.spyOn(fs, 'closeSync');
    expect(() => readEvidence(file)).toThrow(/16 KB/);
    expect(read.mock.calls.reduce((total, call) => total + call[3], 0)).toBe(16001);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  test('closes an invalid JSON file and rejects oversized input', () => {
    fs.writeFileSync(file, '{');
    const closed = jest.spyOn(fs, 'closeSync');
    expect(() => readEvidence(file)).toThrow(SyntaxError);
    expect(closed).toHaveBeenCalledTimes(1);
    fs.writeFileSync(file, 'x'.repeat(16001));
    expect(() => readEvidence(file)).toThrow(/16 KB/);
  });
});
