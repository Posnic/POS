const fs = require('fs');
const path = require('path');

/*
 * Every write to branch_access must stamp updated_date.
 *
 * Sync copies a document only when the other side's updated_date is strictly
 * newer. Creating a branch pushed into the creator's branch_access without
 * touching it, so both copies of the user sat on the same timestamp with
 * different contents - and the till could never learn about a branch created on
 * the web. No amount of resyncing would fix it, because there was nothing for
 * last-write-wins to compare.
 *
 * It looked like sync had failed. It had not: the branch arrived, the
 * permission to see it did not, and the branch list is filtered by that
 * permission. That is the kind of fault worth a test that reads the source,
 * because the behaviour only shows up on a second machine.
 */

const SOURCE = path.join(__dirname, '..', '..', '..', 'src', 'models', 'branch.model.js');
const source = fs.readFileSync(SOURCE, 'utf8');

/* Each User.updateMany(...) call, as its own chunk of text. */
function userUpdates() {
  const calls = [];
  const re = /User\.updateMany\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    let i = m.index + 'User.updateMany'.length;
    for (; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const text = source.slice(m.index, i + 1);
    const line = source.slice(0, m.index).split('\n').length;
    calls.push({ text, line });
  }
  return calls;
}

describe('branch_access changes are visible to sync', () => {
  it('finds the user updates it is meant to be checking', () => {
    // A guard on the guard: if these calls are renamed or moved, this file
    // would silently pass while checking nothing.
    const touching = userUpdates().filter((c) => c.text.includes('branch_access'));
    expect(touching.length).toBeGreaterThanOrEqual(3);
  });

  it('stamps updated_date whenever branch_access is written', () => {
    const unstamped = userUpdates()
      .filter((c) => c.text.includes('branch_access'))
      .filter((c) => !/\$set:\s*\{[^}]*updated_date/.test(c.text))
      .map((c) => 'branch.model.js:' + c.line);

    expect(unstamped).toEqual([]);
  });

  it('stamps the grant made when a branch is created', () => {
    // The specific one the shop hit: branches made on the web were invisible
    // on the till, permanently.
    const create = userUpdates().find((c) => c.text.includes('printing_design: printBranch'));
    expect(create).toBeDefined();
    expect(create.text).toMatch(/\$set:\s*\{\s*updated_date/);
  });

  it('stamps the revoke made when a branch is deleted', () => {
    // Otherwise access to a deleted branch lingers on every other machine.
    const revoke = userUpdates().find(
      (c) => /\$pull/.test(c.text) && c.text.includes('ObjectId(data)')
    );
    expect(revoke).toBeDefined();
    expect(revoke.text).toMatch(/\$set:\s*\{\s*updated_date/);
  });
});
