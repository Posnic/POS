'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {patch,anchor,download}=require('../scripts/fix-snap-template.cjs');
test('template builds stage launcher scripts and unpack the nested runtime exactly once',()=>{
 const fixed=patch(download+'\n'+anchor+'\n...(await readDirPaths(stageDir)),');
 for(const name of ['desktop-init.sh','desktop-common.sh','desktop-gnome-specific.sh'])assert.ok(fixed.includes(name));
 assert.match(fixed,/copyFile/);assert.match(fixed,/chmod.*0o755/);
 assert.match(fixed,/"tar", \["-xf", nestedArchive/);
 assert.ok(fixed.includes('name !== ".template-runtime"'));
 assert.equal(patch(fixed),fixed);
});
test('unexpected builder implementation fails rather than silently skipping the fix',()=>assert.throws(()=>patch('different implementation')));
