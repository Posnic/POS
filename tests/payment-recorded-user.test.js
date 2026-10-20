const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { recordedUserName } = require('../api/src/utils/recorded-user-name');
const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/static/script/js/modules/js/report_payment.js'),'utf8');
const start = source.indexOf('recordedUser: function');
const recordedUser = vm.runInNewContext('({' + source.slice(start, source.indexOf('    showDataTablePage:', start)) + '})').recordedUser;
test('payment names prefer the original saved user and support Captain and legacy records', () => {
  for (const [row, expected] of [
    [{user_name:'Cashier',created_by:'Creator',origin:{actor_name:'Captain'}},'Cashier'],
    [{user_name:'undefined',origin:{actor_name:'Captain'},updated_by:'Later editor'},'Captain'],
    [{user_name:null,created_by:'Creator'},'Creator'],
    [{user_name:'undefined',created_by:'null',origin:{actor_name:'[object Object]'},updated_by:'Editor'},'\u2014'],
    [{},'\u2014']
  ]) {
    assert.equal(recordedUser(row),expected);
    assert.equal(recordedUserName(row.user_name,row.created_by,row.origin?.actor_name),expected==='\u2014'?'':expected);
  }
});
