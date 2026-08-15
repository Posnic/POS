'use strict';

const LoyaltyService = require('../../../src/services/loyalty.service');

// A config expressed as ratios, so these tests hold for any currency: the
// "amount" is just a number in the branch's own currency.
const cfg = {
  enabled: true,
  earn_points: 1,
  earn_amount: 100, // 1 point per 100 spent
  min_spend: 0,
  earn_rounding: 'floor',
  redeem_points: 1,
  redeem_value: 1, // 1 point = 1 unit of currency
  min_redeem: 0,
  max_redeem_percent: 100,
  tiers: [
    { name: 'Bronze', threshold: 0, multiplier: 1 },
    { name: 'Silver', threshold: 1000, multiplier: 1 },
    { name: 'Gold', threshold: 5000, multiplier: 2 },
  ],
};

describe('LoyaltyService.tierFor', () => {
  test('lands in the right tier by lifetime points', () => {
    expect(LoyaltyService.tierFor(0, cfg).name).toBe('Bronze');
    expect(LoyaltyService.tierFor(999, cfg).name).toBe('Bronze');
    expect(LoyaltyService.tierFor(1000, cfg).name).toBe('Silver');
    expect(LoyaltyService.tierFor(6000, cfg).name).toBe('Gold');
  });

  test('sorts an unordered tier config before deciding', () => {
    const c = {
      ...cfg,
      tiers: [
        { name: 'Gold', threshold: 5000, multiplier: 2 },
        { name: 'Bronze', threshold: 0, multiplier: 1 },
      ],
    };
    expect(LoyaltyService.tierFor(10, c).name).toBe('Bronze');
    expect(LoyaltyService.tierFor(9000, c).name).toBe('Gold');
  });
});

describe('LoyaltyService.computeEarn', () => {
  test('earns per the ratio, currency-agnostic', () => {
    expect(LoyaltyService.computeEarn(1000, cfg, 0).points).toBe(10); // 1 per 100
  });

  test('respects the minimum spend', () => {
    expect(LoyaltyService.computeEarn(50, { ...cfg, min_spend: 100 }, 0).points).toBe(0);
  });

  test('applies the tier multiplier from lifetime points', () => {
    // Gold multiplier 2 at 6000 lifetime -> 1000 spend earns 10 * 2 = 20
    expect(LoyaltyService.computeEarn(1000, cfg, 6000).points).toBe(20);
  });

  test('rounds down by default, up when configured', () => {
    expect(LoyaltyService.computeEarn(150, cfg, 0).points).toBe(1); // 1.5 -> floor
    expect(LoyaltyService.computeEarn(150, { ...cfg, earn_rounding: 'ceil' }, 0).points).toBe(2);
  });

  test('earns nothing when loyalty is disabled', () => {
    expect(LoyaltyService.computeEarn(1000, { ...cfg, enabled: false }, 0).points).toBe(0);
  });
});

describe('LoyaltyService.computeRedeem', () => {
  test('values points into the branch currency', () => {
    const r = LoyaltyService.computeRedeem(50, 500, 100, cfg);
    expect(r.valid).toBe(true);
    expect(r.points).toBe(50);
    expect(r.value).toBe(50);
  });

  test('honours a different rate (2 points = 1 unit)', () => {
    const r = LoyaltyService.computeRedeem(100, 500, 200, {
      ...cfg,
      redeem_points: 2,
      redeem_value: 1,
    });
    expect(r.valid).toBe(true);
    expect(r.value).toBe(50);
  });

  test('rejects more points than the customer holds', () => {
    expect(LoyaltyService.computeRedeem(200, 500, 100, cfg).valid).toBe(false);
  });

  test('rejects below the minimum redeem', () => {
    expect(LoyaltyService.computeRedeem(5, 500, 100, { ...cfg, min_redeem: 10 }).valid).toBe(false);
  });

  test('caps the discount at max_redeem_percent of the bill and refunds the rest', () => {
    // 100 points worth 100, bill 200, cap 20% => discount 40, only 40 points spent
    const r = LoyaltyService.computeRedeem(100, 200, 100, { ...cfg, max_redeem_percent: 20 });
    expect(r.capped).toBe(true);
    expect(r.value).toBe(40);
    expect(r.points).toBe(40);
  });

  test('rejects when loyalty is disabled', () => {
    expect(LoyaltyService.computeRedeem(10, 500, 100, { ...cfg, enabled: false }).valid).toBe(
      false
    );
  });
});
