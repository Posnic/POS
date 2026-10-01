'use strict';

const { EventEmitter } = require('node:events');
const { createParser } = require('../../../src/services/knowledge-pdf-parser');

function fixture(options = {}) {
  const children = [];
  const launch = jest.fn(() => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = jest.fn();
    child.stdout = new EventEmitter();
    child.kill = jest.fn();
    children.push(child);
    return child;
  });
  return { parse: createParser({ launch, ...options }), launch, children };
}
const pdf = Buffer.from('%PDF-1.4\nsynthetic');

describe('isolated PDF process limits', () => {
  test('concurrency remains occupied until a timed-out child exits, then accepts new work', async () => {
    jest.useFakeTimers();
    try {
      const f = fixture({ concurrency: 1, timeoutMs: 30 });
      const first = f.parse(pdf);
      const rejected = expect(first).rejects.toThrow(/timed out/);
      await expect(f.parse(pdf)).rejects.toThrow(/busy/);
      jest.advanceTimersByTime(31);
      expect(f.children[0].kill).toHaveBeenCalledWith('SIGKILL');
      await expect(f.parse(pdf)).rejects.toThrow(/busy/);
      f.children[0].emit('close', null);
      await rejected;
      const second = f.parse(pdf);
      f.children[1].stdout.emit('data', Buffer.from('{"text":"Next document","pages":1}'));
      f.children[1].emit('close', 0);
      await expect(second).resolves.toEqual({ text: 'Next document', pages: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  test('starts with bounded heap and without AWS or application secrets', async () => {
    const prior = process.env.ASK_POSNIC_ACTION_SECRET;
    const priorElectron = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ASK_POSNIC_ACTION_SECRET = 'synthetic-not-for-parser';
    process.env.ELECTRON_RUN_AS_NODE = '1';
    try {
      const f = fixture();
      const result = f.parse(pdf);
      const [, args, options] = f.launch.mock.calls[0];
      expect(args).toContain('--max-old-space-size=128');
      expect(options.env.ASK_POSNIC_ACTION_SECRET).toBeUndefined();
      expect(options.env.AWS_ACCESS_KEY_ID).toBeUndefined();
      expect(options.env.NODE_OPTIONS).toBeUndefined();
      expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1');
      expect(options.windowsHide).toBe(true);
      f.children[0].stdout.emit('data', Buffer.from('{"text":"Extracted","pages":1}'));
      f.children[0].emit('close', 0);
      await expect(result).resolves.toEqual({ text: 'Extracted', pages: 1 });
    } finally {
      if (prior === undefined) delete process.env.ASK_POSNIC_ACTION_SECRET;
      else process.env.ASK_POSNIC_ACTION_SECRET = prior;
      if (priorElectron === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = priorElectron;
    }
  });

  test('kills excessive output and rejects it without parsing a partial document', async () => {
    const f = fixture();
    const result = f.parse(pdf);
    const rejected = expect(result).rejects.toThrow(/output limit/);
    f.children[0].stdout.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(f.children[0].kill).toHaveBeenCalledWith('SIGKILL');
    f.children[0].emit('close', null);
    await rejected;
  });

  test.each([
    ['{"error":"too_large"}', 0, /200,000/],
    ['not JSON', 0, /invalid content/],
    ['{"text":"Hello","pages":-1}', 0, /invalid content/],
    ['', 1, /extraction failed/],
  ])('rejects invalid worker result %s', async (output, code, expected) => {
    const f = fixture();
    const result = f.parse(pdf);
    const rejected = expect(result).rejects.toThrow(expected);
    f.children[0].stdout.emit('data', Buffer.from(output));
    f.children[0].emit('close', code);
    await rejected;
  });

  test('rejects oversized inputs without spawning and recovers from launch failures', async () => {
    const f = fixture({ concurrency: 1 });
    await expect(f.parse(Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow(/10 MB/);
    expect(f.launch).not.toHaveBeenCalled();
    f.launch.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    await expect(f.parse(pdf)).rejects.toThrow(/could not start/);
    const result = f.parse(pdf);
    const rejected = expect(result).rejects.toThrow(/could not start/);
    f.children[0].emit('error', new Error('unavailable'));
    await rejected;
    f.children[0].emit('close', -1);
  });
});
