const { getRequestContext, runWithRequestContext } = require('../../../src/utils/request-context');

describe('request context isolation', () => {
  test('keeps concurrent branch and license values isolated', async () => {
    const readLater = (values) =>
      new Promise((resolve) => {
        runWithRequestContext(values, () => {
          setImmediate(() => resolve(getRequestContext()));
        });
      });

    const [first, second] = await Promise.all([
      readLater({ currentBranch: 'branch-a', license: 'license-a' }),
      readLater({ currentBranch: 'branch-b', license: 'license-b' }),
    ]);

    expect(first).toMatchObject({ currentBranch: 'branch-a', license: 'license-a' });
    expect(second).toMatchObject({ currentBranch: 'branch-b', license: 'license-b' });
  });
});
