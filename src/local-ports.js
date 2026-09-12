/*
 * Which local ports this installation uses.
 *
 * Two problems, one answer.
 *
 * The bundled MongoDB listened on 27018. That is not the default 27017, but it
 * is the next thing anyone picks for a second instance, so it collides with
 * whatever else on the machine had the same idea. The API had the same trouble
 * on 5555. Neither range is ours to assume.
 *
 * Separately, two brands of this app on one machine - a shop trialling their
 * own white-label build beside the stock one - both wanted the same two ports
 * and the second to start would fail in a way nobody could read.
 *
 * So derive the pair from the application name, in ranges nothing standard
 * claims, and remember the answer. Two brands land on different ports because
 * their names differ; the same brand lands on the same ports every launch
 * because the choice is written down. If the derived port turns out to be busy
 * we step to the next free one and record that instead, so a machine that
 * gains some unrelated service later does not break a working till.
 *
 * IANA has these ranges as unassigned, and they are far from the ports any
 * database, proxy or dev server reaches for by habit.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const MONGO_BASE = 47000;   // 47000-47899
const API_BASE = 42000;     // 42000-42899

/*
 * THE PORT A HANDSET LOOKS FOR.
 *
 * The Captain app sweeps the Wi-Fi for this one. When the API moved to a
 * derived port, nothing told the app, so it probed 254 addresses per subnet on
 * a port the till had abandoned and found nothing - on every network, for
 * every shop. Measured on a real install: the till answered
 * /api/runtime-info with 200 on its derived port and refused the connection
 * on 5555, which is exactly what a sweep sees.
 *
 * So the API asks for 5555 FIRST and only derives a port when it cannot have
 * it. The reasons for deriving one have not gone away - 5555 collides with
 * whatever else had the same idea, and two brands on one machine need two
 * ports - they are simply the fallback rather than the default, so the common
 * case is one port that both sides already agree on.
 */
const DISCOVERY_PORT = 5555;
const SPAN = 900;
const MAX_STEPS = 40;       // give up rather than scan the whole range

function derive(name, base) {
  const digest = crypto.createHash('sha256').update(String(name || 'posnic')).digest();
  return base + (digest.readUInt16BE(0) % SPAN);
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    // 127.0.0.1 only: these listeners are local, and a port free on the
    // loopback interface is what actually matters here.
    server.listen(port, '127.0.0.1');
  });
}

async function firstFreeFrom(start, alreadyTaken) {
  for (let i = 0; i < MAX_STEPS; i++) {
    const port = start + i;
    if (alreadyTaken.includes(port)) continue;
    if (await portIsFree(port)) return port;
  }
  return null;
}

/*
 * Resolve this installation's ports.
 *
 * `appName` separates brands. `userDataPath` is where the answer is kept, so
 * an install that has been running on a port keeps it: the sync agent and the
 * saved credentials both hold a URI, and moving underneath them would strand a
 * till that was working yesterday.
 */
async function resolveLocalPorts({ appName, userDataPath }) {
  const file = path.join(userDataPath, '.ports.json');

  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first run */ }

  if (saved && saved.mongoPort && saved.apiPort) {
    /*
     * AN INSTALL ALREADY ON A DERIVED PORT MOVES BACK, if 5555 is free.
     *
     * Reusing the saved answer is normally the whole point: the sync agent and
     * the saved credentials hold a URI, and moving underneath them strands a
     * till that was working yesterday. But a till on a derived port cannot be
     * found by a handset at all, which is worse than a re-login - and nothing
     * that reads this port is written down anywhere: the window, the connector
     * runtime and the hardware bridge all compute it fresh each launch.
     *
     * The one real cost is the session cookie, which is scoped to
     * http://localhost:<port> and stops matching. The app already notices a
     * stale login and clears it, so it is one sign-in, once.
     *
     * Mongo is left exactly where it is. Nothing outside this machine looks
     * for it, and its data directory is bound to the port it was created with.
     */
    if (saved.apiPort !== DISCOVERY_PORT && (await portIsFree(DISCOVERY_PORT))) {
      const moved = { ...saved, apiPort: DISCOVERY_PORT, movedAt: new Date().toISOString() };
      try {
        fs.writeFileSync(file, JSON.stringify(moved, null, 2));
      } catch (e) {
        console.warn('[ports] could not record the move to 5555:', e.message);
      }
      return { ...moved, reused: true, movedToDiscovery: true };
    }
    return { ...saved, reused: true };
  }

  const wantMongo = derive(appName, MONGO_BASE);
  const wantApi = derive(appName, API_BASE);

  const mongoPort = await firstFreeFrom(wantMongo, []);

  /*
   * 5555 first, then the derived port.
   *
   * A new install lands where the handset is already looking. Only a machine
   * that genuinely cannot have 5555 falls back to the range, and that is the
   * case the range was invented for.
   */
  const apiPort = (await portIsFree(DISCOVERY_PORT))
    ? DISCOVERY_PORT
    : await firstFreeFrom(wantApi, [mongoPort]);

  if (!mongoPort || !apiPort) {
    const which = !mongoPort ? 'database' : 'application';
    const from = !mongoPort ? wantMongo : wantApi;
    const error = new Error(
      `Could not find a free port for the ${which}. Tried ${MAX_STEPS} ports from ${from}. ` +
      'Another program is probably using this range.'
    );
    error.code = 'NO_FREE_PORT';
    throw error;
  }

  const chosen = { mongoPort, apiPort, appName: String(appName || ''), chosenAt: new Date().toISOString() };
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(chosen, null, 2));
  } catch (e) {
    // Not fatal: this run works, the choice is simply made again next time.
    console.warn('[ports] could not save the port choice:', e.message);
  }
  return { ...chosen, reused: false, movedFromPreferred: mongoPort !== wantMongo || apiPort !== wantApi };
}

module.exports = { resolveLocalPorts, derive, portIsFree, MONGO_BASE, API_BASE, DISCOVERY_PORT };
