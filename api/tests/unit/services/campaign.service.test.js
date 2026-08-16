'use strict';

const CampaignService = require('../../../src/services/campaign.service');
const { SEGMENT_TYPE, CHANNEL } = require('../../../src/constants/campaign.constants');

describe('CampaignService.renderMessage', () => {
  const cust = {
    name: 'Asha',
    phone: '+91999',
    loyalty: { points: 240, pointsEarned: 1000, tier: 'gold' },
  };

  test('fills known merge fields', () => {
    const out = CampaignService.renderMessage(
      'Hi {name}, you have {points} points ({tier}).',
      cust
    );
    expect(out).toBe('Hi Asha, you have 240 points (gold).');
  });

  test('balance and lifetime map to the wallet', () => {
    expect(CampaignService.renderMessage('{balance}/{lifetime}', cust)).toBe('240/1000');
  });

  test('leaves unknown fields untouched and tolerates missing data', () => {
    expect(CampaignService.renderMessage('Hi {name} {unknown}', { name: 'Bo' })).toBe(
      'Hi Bo {unknown}'
    );
    expect(CampaignService.renderMessage('{points}', {})).toBe('0');
  });
});

describe('CampaignService.buildAudienceQuery', () => {
  test('all -> no filter', () => {
    expect(CampaignService.buildAudienceQuery({ type: SEGMENT_TYPE.ALL })).toEqual({});
  });

  test('tier / min_points / category', () => {
    expect(CampaignService.buildAudienceQuery({ type: SEGMENT_TYPE.TIER, tier: 'gold' })).toEqual({
      'loyalty.tier': 'gold',
    });
    expect(
      CampaignService.buildAudienceQuery({ type: SEGMENT_TYPE.MIN_POINTS, min_points: 100 })
    ).toEqual({ 'loyalty.points': { $gte: 100 } });
    const cat = CampaignService.buildAudienceQuery({
      type: SEGMENT_TYPE.CATEGORY,
      category_id: '64c111111111111111111111',
    });
    expect(String(cat.category_id)).toBe('64c111111111111111111111');
  });

  test('lapsed builds a cutoff from now minus the window', () => {
    const now = new Date('2026-08-15').getTime();
    const q = CampaignService.buildAudienceQuery(
      { type: SEGMENT_TYPE.LAPSED, lapsed_days: 30 },
      now
    );
    expect(Array.isArray(q.$or)).toBe(true);
    const cutoff = q.$or[0].lastPurchaseDate.$lt;
    expect(cutoff.getTime()).toBe(now - 30 * 24 * 60 * 60 * 1000);
  });
});

describe('CampaignService.optedIn', () => {
  test('respects per-channel notification preferences', () => {
    const optedOutSms = { preferences: { smsNotifications: false, whatsappNotifications: true } };
    expect(CampaignService.optedIn(optedOutSms, CHANNEL.SMS)).toBe(false);
    expect(CampaignService.optedIn(optedOutSms, CHANNEL.WHATSAPP)).toBe(true);
    // Missing preferences default to opted-in.
    expect(CampaignService.optedIn({}, CHANNEL.SMS)).toBe(true);
  });
});
