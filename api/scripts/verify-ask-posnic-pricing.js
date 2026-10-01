'use strict';

// Read-only: verifies the checked-in selected-model rates against AWS, never
// alters prices, paid catalogs, account settings or AWS resources.
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const snapshots = [require('../infra/ask-posnic-bedrock-pricing.json'), require('../infra/ask-posnic-embedding-pricing.json')];
const profile = process.env.AWS_PROFILE || 'posnic-admin';
const evidence = [];
for (const expected of snapshots) for (const [side, usageType, sku] of [['in', expected.inputUsageType, expected.inputSku], ['out', expected.outputUsageType, expected.outputSku]].filter((row) => row[1])) {
  const result = JSON.parse(execFileSync('aws', ['pricing', 'get-products', '--service-code', 'AmazonBedrock', '--filters', `Type=TERM_MATCH,Field=regionCode,Value=${expected.region}`, `Type=TERM_MATCH,Field=usagetype,Value=${usageType}`, '--region', 'us-east-1', '--profile', profile, '--max-results', '10', '--output', 'json', '--no-cli-pager'], { encoding: 'utf8', timeout: 30000 }));
  assert.equal(result.PriceList.length, 1, 'Expected exactly one selected-model price');
  const product = JSON.parse(result.PriceList[0]);
  assert.equal(product.product.sku, sku);
  const terms = Object.values(product.terms.OnDemand);
  assert.equal(terms.length, 1);
  const dimensions = Object.values(terms[0].priceDimensions);
  assert.equal(dimensions.length, 1);
  const rate = dimensions[0];
  assert.equal(rate.unit, '1K tokens');
  assert.equal(Number((Number(rate.pricePerUnit.USD) * 1000).toFixed(10)), expected[side], 'AWS rate changed; review the pricing snapshot before updating it');
  evidence.push({ model: expected.model, region: expected.region, side, sku, usdPerMillionTokens: expected[side], effectiveDate: terms[0].effectiveDate, version: product.version });
}
console.log(JSON.stringify({ result: 'PASS', evidence }, null, 2));
