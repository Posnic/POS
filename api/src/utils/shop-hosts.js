'use strict';

/*
 * Every name a shop answers to.
 *
 * WHAT WAS WRONG.
 *
 * A shop's hostname was built by concatenation:
 *
 *   next.set(`${t.subdomain}.posnic.io`, entry);
 *
 * one line in the shard, and about eight more of the same shape in the
 * provisioner: the nginx map, the generated `server_name`, the suspended-shop
 * map, the port allocator. That was true while there was one domain to serve
 * shops on, and it stopped being true the moment a shop had to answer on a
 * second one.
 *
 * It has to answer on a second one. A reseller's customer is at
 * `cusxyz.xbill.in`. A reseller who buys their own domain moves every one of
 * their customers onto `shopname.theirdomain.com` in an afternoon. Neither is
 * expressible as a suffix pasted onto a subdomain, and worse, each generator
 * would have to grow the same new rule independently - which is exactly how a
 * shop ends up answering on one of its names and not the others, reachable in
 * nginx and unknown to the application, or the reverse.
 *
 * So the names come from data, in one function, and everything that needs to
 * know asks it.
 *
 * WHY THE DEFAULT MATTERS.
 *
 * `SHOP_BASE_DOMAINS` defaults to `posnic.io`, so an estate that sets nothing
 * keeps every shop on exactly the name it has today. This can ship and be
 * deployed before any DNS, any certificate or any reseller exists, which is
 * the only way a change this load-bearing is safe to make: it is inert until
 * somebody sets the variable.
 */

/**
 * The domains this company serves shops on, newest-first is irrelevant; order
 * only decides which name is listed first, never which one works.
 *
 * @param {object} [env]
 * @returns {string[]} bare domains, lowercased, no leading dot
 */
function baseDomains(env = process.env) {
  return String(env.SHOP_BASE_DOMAINS || 'posnic.io')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^\.+/, ''))
    .filter(Boolean);
}

/**
 * Every hostname one shop answers to, lowercased and deduplicated.
 *
 * Three sources, in order of authority:
 *
 *   - `hosts`, an explicit list on the tenant, for anything decided by hand;
 *   - `<subdomain>.<base>` for each configured base domain, which is where the
 *     whole estate lives today;
 *   - `webDomain`, the customer's own address.
 *
 * A tenant with none of the three gets an empty list and is not served, rather
 * than served under a derived guess. An unreachable shop is a support ticket;
 * a shop reachable at a name we did not mean is one business looking at
 * another's data.
 *
 * @param {object} tenant  {subdomain, hosts, webDomain}
 * @param {object} [env]
 * @returns {string[]}
 */
function hostsFor(tenant, env = process.env) {
  const t = tenant || {};
  const out = [];
  const seen = new Set();

  const add = (value) => {
    /* Split on the colon so a port can never smuggle a second name in, and
       lowercase because a Host header arrives however the client typed it. */
    const host = String(value || '')
      .trim()
      .toLowerCase()
      .split(':')[0];
    if (!host || seen.has(host)) return;
    seen.add(host);
    out.push(host);
  };

  for (const host of Array.isArray(t.hosts) ? t.hosts : []) add(host);
  if (t.subdomain) for (const base of baseDomains(env)) add(`${t.subdomain}.${base}`);
  add(t.webDomain);

  return out;
}

module.exports = { baseDomains, hostsFor };
