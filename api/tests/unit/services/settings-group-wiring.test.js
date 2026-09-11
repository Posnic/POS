'use strict';

/**
 * The two lists that have to agree about what a settings group is.
 *
 * WHY THIS FILE EXISTS.
 *
 * A settings group is declared twice: `GROUPS` in services/settings-groups.js
 * says which keys belong to it, and `COLLECTION_OF` in
 * repositories/settings.repository.js says which collection holds them. Adding
 * a group to one and not the other is silent - the route exists, the controller
 * accepts the name, and the repository answers "Unknown settings group" for
 * every read and every write.
 *
 * That is exactly what happened to `channels`. The settings screen could never
 * load it and could never save it, and it shipped, because no test compared
 * the two lists and the unit tests either side both mocked the other.
 *
 * A second copy of a list is a second thing to keep true. This is the check
 * that makes it one.
 */

const fs = require('fs');
const path = require('path');

const { GROUPS } = require('../../../src/services/settings-groups');

const REPO_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'repositories', 'settings.repository.js'),
  'utf8'
);

/* Read the map out of the source rather than importing the repository: it
   extends BaseModel and constructing one reaches for a database. */
function collectionMap() {
  const block = REPO_SRC.match(/const COLLECTION_OF = Object\.freeze\(\{([\s\S]*?)\}\);/);
  expect(block).not.toBeNull();

  const map = {};
  for (const m of block[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)) {
    map[m[1]] = m[2];
  }
  return map;
}

describe('settings groups are wired end to end', () => {
  test('every declared group has a collection to live in', () => {
    const map = collectionMap();
    const orphans = Object.keys(GROUPS).filter((group) => !map[group]);
    expect(orphans).toEqual([]);
  });

  test('every mapped collection belongs to a group that exists', () => {
    /* The other direction. A collection for a group nobody declares is dead
       weight, and more usefully it means somebody renamed a group and left
       half the rename behind. */
    const map = collectionMap();
    const strays = Object.keys(map).filter((group) => !GROUPS[group]);
    expect(strays).toEqual([]);
  });

  test('the channels group in particular, because it shipped broken', () => {
    /* Named explicitly so the regression reads as itself rather than as a
       count. Online ordering, partner venues, delivery charges and the order
       approval mode all live in this group; without the mapping the settings
       screen answered "Unknown settings group" to every one of them. */
    expect(GROUPS.channels).toBeDefined();
    expect(collectionMap().channels).toBe('branch_channels');
  });

  test('no group is mapped to the same collection as another', () => {
    /* Two groups sharing a collection would let a caller handed one group read
       and overwrite the other's keys, which is the whole thing this
       architecture exists to prevent. */
    const collections = Object.values(collectionMap());
    expect(collections).toHaveLength(new Set(collections).size);
  });
});
