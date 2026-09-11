'use strict';

/*
 * The names a shop answers to.
 *
 * This replaced `${t.subdomain}.posnic.io`, concatenated in the shard and in
 * about eight more places in the provisioner. The danger in changing it is not
 * that the new names fail - somebody would notice that on the first request -
 * but that the OLD ones quietly stop working, or that a shop ends up reachable
 * at a name nobody meant. Both are silent, and one of them shows a business
 * somebody else's data.
 *
 * So the first test is the one that matters most: with nothing configured,
 * every shop in the estate keeps exactly the hostname it has today.
 */

const { hostsFor, baseDomains } = require('../../../src/utils/shop-hosts');

describe('the hostnames a shop answers to', () => {
  it('changes nothing at all until somebody configures it', () => {
    /* The whole estate runs with SHOP_BASE_DOMAINS unset. This is the promise
       that lets the change deploy before any DNS or certificate exists. */
    expect(baseDomains({})).toEqual(['posnic.io']);
    expect(hostsFor({ subdomain: 'cusxyz' }, {})).toEqual(['cusxyz.posnic.io']);
  });

  it('serves a shop on every base domain it is given', () => {
    /* A reseller's customer is at cusxyz.xbill.in. The posnic.io name stays,
       because support needs a name that does not depend on whose customer this
       is, and because taking it away would break links already sent. */
    expect(hostsFor({ subdomain: 'cusxyz' }, { SHOP_BASE_DOMAINS: 'posnic.io,xbill.in' })).toEqual([
      'cusxyz.posnic.io',
      'cusxyz.xbill.in',
    ]);
  });

  it('takes an explicit list first, and a customer domain last', () => {
    const hosts = hostsFor(
      { subdomain: 'cusxyz', hosts: ['pinned.example'], webDomain: 'shop.abc.com' },
      { SHOP_BASE_DOMAINS: 'xbill.in' }
    );
    expect(hosts).toEqual(['pinned.example', 'cusxyz.xbill.in', 'shop.abc.com']);
  });

  it('normalises what it is given, because a Host header is typed by a stranger', () => {
    /*
     * Three separate ways the same shop could be registered twice, or once
     * under a name that never matches: upper case, surrounding space, and a
     * port. resolve() lowercases and strips the port before it looks a host
     * up, so anything stored differently is simply never found.
     */
    const hosts = hostsFor(
      {
        subdomain: 'cusxyz',
        hosts: ['  CusXyz.Xbill.IN ', 'cusxyz.xbill.in'],
        webDomain: 'Shop.ABC.com:443',
      },
      { SHOP_BASE_DOMAINS: 'xbill.in' }
    );
    expect(hosts).toEqual(['cusxyz.xbill.in', 'shop.abc.com']);
  });

  it('leads with a dot on a base domain without producing a double dot', () => {
    expect(baseDomains({ SHOP_BASE_DOMAINS: '.xbill.in, .pluskb.com' })).toEqual([
      'xbill.in',
      'pluskb.com',
    ]);
    expect(hostsFor({ subdomain: 'cusxyz' }, { SHOP_BASE_DOMAINS: '.xbill.in' })).toEqual([
      'cusxyz.xbill.in',
    ]);
  });

  it('gives a nameless tenant no names, rather than a guess', () => {
    /* An unreachable shop is a support ticket. A shop reachable at a name we
       did not mean is one business looking at another's data, so the empty
       answer is the safe one and the registry skips the tenant. */
    expect(hostsFor({}, {})).toEqual([]);
    expect(hostsFor(null, {})).toEqual([]);
    expect(hostsFor({ hosts: 'not-an-array' }, { SHOP_BASE_DOMAINS: 'xbill.in' })).toEqual([]);
  });

  it('ignores empty entries instead of registering the empty string', () => {
    /* `next.set('', entry)` would be matched by any request whose Host header
       we failed to parse. */
    expect(
      hostsFor(
        { subdomain: 'cusxyz', hosts: ['', '   ', null], webDomain: '' },
        { SHOP_BASE_DOMAINS: 'xbill.in' }
      )
    ).toEqual(['cusxyz.xbill.in']);
  });
});
