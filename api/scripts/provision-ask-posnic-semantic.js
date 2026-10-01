'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const ACCOUNT = '719443252592', REGION = 'ap-south-1', BUCKET = `posnic-ask-${ACCOUNT}`, INDEX = 'knowledge-v1';
const PROFILE = process.env.AWS_PROFILE || 'posnic-admin';
const apply = process.argv.includes('--apply');
function aws(args, allowMissing = false) {
  try { return JSON.parse(execFileSync('aws', [...args, '--profile', PROFILE, '--region', REGION, '--output', 'json', '--no-cli-pager'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }) || '{}'); }
  catch (error) { if (allowMissing && /NotFoundException|NoSuchEntity/.test(String(error.stderr))) return null; throw new Error(`AWS ${args.slice(0, 2).join(' ')} failed; inspect account permissions.`); }
}
assert.equal(aws(['sts', 'get-caller-identity']).Account, ACCOUNT);
const host = aws(['lightsail', 'get-instance', '--instance-name', 'posnic-core-8gb']).instance;
assert.equal(host.publicIpAddress, '13.207.75.191');
assert.ok(host.ipv6Addresses?.includes('2406:da1a:816:a100:c61d:b8f1:54a5:4122'));
assert.equal(host.state.name, 'running');
const user = aws(['iam', 'get-user', '--user-name', 'posnic-ask-bedrock']).User;
assert.ok(user.Tags?.some((tag) => tag.Key === 'Application' && tag.Value === 'PosnicAsk'));
let bucket = aws(['s3vectors', 'get-vector-bucket', '--vector-bucket-name', BUCKET], true);
if (!bucket && apply) {
  aws(['s3vectors', 'create-vector-bucket', '--vector-bucket-name', BUCKET, '--encryption-configuration', JSON.stringify({ sseType: 'AES256' }), '--tags', JSON.stringify({ Application: 'PosnicAsk', Purpose: 'ApprovedKnowledge' })]);
  bucket = aws(['s3vectors', 'get-vector-bucket', '--vector-bucket-name', BUCKET]);
}
let index = bucket ? aws(['s3vectors', 'get-index', '--vector-bucket-name', BUCKET, '--index-name', INDEX], true) : null;
if (!index && apply) {
  aws(['s3vectors', 'create-index', '--vector-bucket-name', BUCKET, '--index-name', INDEX, '--data-type', 'float32', '--dimension', '256', '--distance-metric', 'cosine', '--tags', JSON.stringify({ Application: 'PosnicAsk' })]);
  index = aws(['s3vectors', 'get-index', '--vector-bucket-name', BUCKET, '--index-name', INDEX]);
}
if (index) {
  assert.equal(index.index.dimension, 256);
  assert.equal(index.index.distanceMetric, 'cosine');
  assert.equal(index.index.dataType, 'float32');
}
if (apply) aws(['iam', 'put-user-policy', '--user-name', 'posnic-ask-bedrock', '--policy-name', 'UsePosnicSemanticKnowledge', '--policy-document', 'file://' + path.resolve(__dirname, '../infra/ask-posnic-semantic-policy.json').replace(/\\/g, '/')]);
console.log(JSON.stringify({ apply, account: ACCOUNT, region: REGION, bucket: BUCKET, index: INDEX, exists: Boolean(index), dimension: 256, app_environment_changed: false }, null, 2));
