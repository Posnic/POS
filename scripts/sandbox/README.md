# The develop sandbox

What runs on **develop.posnic.io** — the public box that every merge to
`develop` is deployed to, so anybody can try a change without checking anything
out.

These live in the repository rather than only on the machine so the sandbox can
be rebuilt rather than remembered. A box that exists only as somebody's shell
history is a box nobody can recreate after it breaks.

| File | What |
|---|---|
| `bootstrap.sh` | Prepares a fresh Ubuntu 24.04 machine: Node, MongoDB, nginx, pm2, and secrets generated **on that machine** |
| `nginx-develop.conf` | Proxy, rate limit, `robots.txt`, and the sandbox banner |
| `reset.sh` | Returns the sandbox to a known state; run nightly by cron |

## The rule all of this follows

**This machine runs unreviewed code from strangers.**

- It is **not** registered in the estate console. A registered instance can be
  handed a real customer's shop by the provisioner, and nothing afterwards
  would undo that.
- It has its **own** database and its **own** secrets, generated on the box.
- It holds **no** production credential — not the control database, not S3, not
  payments, not mail. Not by guarding them, but by never sending them.
- It has **no SSH keys**, so it cannot reach another machine.

If it is ever compromised, the answer is to delete it and make another. That is
only an acceptable answer because the four points above are true.

## The banner

Injected by nginx, not built into the application. The app has no business
carrying a warning it must never show a real shop — a flag for that is one bad
default away from appearing on a customer's till. This config exists only on
the sandbox, so there is no path by which it reaches production.

It sits at the **bottom** of the page. The top of these screens is a working
till, and covering it is how a banner becomes something people learn to ignore.

## The nightly reset

The banner promises the data is wiped nightly, so that has to be true. A
promise the software does not keep is worse than no promise: somebody will
decide the box is safe for real data.

```bash
./reset.sh              # restore the seed, or empty the database if there is none
./reset.sh --capture    # make the CURRENT state the seed
```

**Capture is the useful part.** With no seed, every tester has to walk the setup
wizard before they can test anything, and most will not bother. Set a shop up
once with sensible demo products, capture it, and every night returns to that.

Capture refuses a dump under 2 KB. Seeding from an empty database would wipe the
sandbox every night while looking like it was working.

## Rebuilding it

```bash
# on a fresh Ubuntu 24.04 Lightsail instance
scp scripts/sandbox/bootstrap.sh ubuntu@<ip>:/tmp/
ssh ubuntu@<ip> 'bash /tmp/bootstrap.sh'
scp scripts/sandbox/nginx-develop.conf ubuntu@<ip>:/tmp/
ssh ubuntu@<ip> 'sudo cp /tmp/nginx-develop.conf /etc/nginx/sites-available/develop && sudo nginx -t && sudo systemctl reload nginx'
scp scripts/sandbox/reset.sh ubuntu@<ip>:~/posnic-develop/
```

Then point `DEVELOP_HOST` at the new address. The deploy workflow does the rest.
