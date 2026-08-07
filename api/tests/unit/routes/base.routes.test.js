'use strict';

jest.mock('../../../src/controllers/base.controller', () => {
  return jest.fn().mockImplementation(() => ({
    success: jest.fn((res, data, message) => res.status(200).json({ data, message })),
    autoSuggestionTableField: jest.fn((req, res) => res.status(200).json({ route: 'table' })),
    autoSuggestionReportTableField: jest.fn((req, res) =>
      res.status(200).json({ route: 'report' })
    ),
    getDefaultSuggest: jest.fn((req, res) => res.status(200).json({ route: 'default' })),
  }));
});

/*
 * optionalProtect is mocked as well as protect: /health uses it to decide how
 * much to say. An unauthenticated caller gets status, time and uptime; the
 * version, platform and memory figures - the list wanted by someone choosing
 * which published Node vulnerability to try - are kept for callers who have
 * signed in. Leaving it out of this mock makes Express throw on a route whose
 * handler is undefined.
 */
jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
  optionalProtect: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/base.routes');

describe('base routes', () => {
  const findRoute = (method, path) =>
    router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);

  test('exposes root health route', () => {
    const layer = findRoute('get', '/');
    const req = {};
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    layer.route.stack[0].handle(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: { status: 'running' },
      message: 'API is running',
    });
  });

  /* stack[0] is optionalProtect; the handler is the one after it. */
  const healthHandler = () => findRoute('get', '/health').route.stack[1].handle;

  test('tells a stranger that it is up, and nothing else', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    healthHandler()({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const { data } = res.json.mock.calls[0][0];
    expect(data.status).toBe('UP');
    expect(data.uptime).toEqual(expect.any(Number));

    /* The runtime details are the shopping list of someone deciding which
       published Node vulnerability to try. They used to be handed over without
       anyone being asked for a password. */
    expect(data).not.toHaveProperty('node');
    expect(data).not.toHaveProperty('platform');
    expect(data).not.toHaveProperty('env');
    expect(data).not.toHaveProperty('memory');
  });

  test('tells a signed-in caller the detail', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    healthHandler()({ user: { _id: 'u1' } }, res);

    const { data } = res.json.mock.calls[0][0];
    expect(data.status).toBe('UP');
    expect(data.node).toBe(process.version);
    expect(data.platform).toBe(process.platform);
    expect(data.env).toEqual(expect.any(String));
    expect(data.memory).toEqual(expect.any(Object));
  });

  test('exposes suggestion routes', () => {
    expect(findRoute('get', '/autoSuggestionTableField')).toBeTruthy();
    expect(findRoute('get', '/autoSuggestionReportTableField')).toBeTruthy();
    expect(findRoute('get', '/getDefaultSuggest')).toBeTruthy();
  });

  test('protects suggestion routes while keeping health routes reachable', () => {
    expect(findRoute('get', '/').route.stack).toHaveLength(1);
    /* Two now: optionalProtect, then the handler. optionalProtect never refuses,
       so /health is still reachable without signing in - it just answers with
       less. */
    expect(findRoute('get', '/health').route.stack).toHaveLength(2);
    expect(findRoute('get', '/autoSuggestionTableField').route.stack).toHaveLength(2);
    expect(findRoute('get', '/autoSuggestionReportTableField').route.stack).toHaveLength(2);
    expect(findRoute('get', '/getDefaultSuggest').route.stack).toHaveLength(2);
  });
});
