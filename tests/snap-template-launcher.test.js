'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {patch}=require('../scripts/fix-snap-template.cjs');
const anchor='        await this.stageSnapFiles({ stageDir, appOutDir, hooksDir, extraAppArgs, isTemplate: true });';
test('template builds stage every script invoked by their launcher with executable mode',()=>{
 const fixed=patch(anchor);
 for(const name of ['desktop-init.sh','desktop-common.sh','desktop-gnome-specific.sh'])assert.ok(fixed.includes(name));
 assert.match(fixed,/copyFile/);assert.match(fixed,/chmod.*0o755/);
 assert.equal(patch(fixed),fixed);
});
test('unexpected builder implementation fails rather than silently skipping the fix',()=>assert.throws(()=>patch('different implementation')));
