# Testing changes on develop

**You do not need write access, and you do not need to be the person who wrote
the change.** Testing somebody else's work is one of the most useful things
anyone can do here, and it needs no permissions at all.

Reporting that something is broken is as valuable as fixing it. It is much
better found here than by a shopkeeper mid-sale.

---

## Find something to test

Anything labelled [`ready for QA`](https://github.com/Posnic/POS/labels/ready%20for%20QA)
has been merged to `develop` and is waiting for somebody to try it. The label
is set automatically when a pull request is merged, along with a comment saying
where to test it.

## Try it

Either way works:

**On the sandbox** — https://develop.posnic.io, no setup at all.

**Locally**, which lets you look at logs and try things the sandbox will not
let you break:

```bash
git fetch origin develop && git checkout develop
npm install && npm --prefix api install
npm run dev        # then http://localhost:3000
```

## Say what happened

Comment on the pull request. A useful QA comment answers three things:

1. **What you did** — the steps, in order, including the ones that seem
   obvious. "Made a sale with two items and paid cash" is a fact; "tested the
   sale screen" is not.
2. **What happened** — what you saw, not what you concluded.
3. **What you expected** — only where those differ.

Then set `QA passed` or `QA failed`. If you cannot set labels, just say so in
the comment and a maintainer will.

### If it works

> Tried on develop.posnic.io. Added a product with a 5% tax rate, sold two of
> them, paid cash. Receipt totals and the tax line were right. Also checked the
> sale appears in Sales History with the same total.
>
> `QA passed`

### If it does not

> Tried locally on develop (`npm run dev`). Added a product with a 5% tax rate
> and sold two. The receipt shows tax as 0.00, though the sale total includes
> it. Sales History shows the right total.
>
> Steps: new item -> tax 5% -> sale screen -> add 2 -> pay cash -> print preview
> Browser: Firefox 141, Windows 11
>
> `QA failed`

The second one is more useful than the first, and neither needed permission to
write.

---

## What is worth checking

Not a checklist to complete - a prompt for the things that actually break.

**Does the change do what it says?** Read the pull request description and try
exactly that.

**Does anything near it still work?** Changes to the sale screen are worth a
sale, a return and a receipt. Changes to items are worth creating, editing and
searching one.

**Does it work in another language?** Switch to Tamil in the top bar. Text that
overflows a button or wraps badly is a real defect, because screens were laid
out around English.

**Does it work offline?** Posnic is offline-first and shops lose connections.
For anything touching sales or printing, try it with the network off.

**Does it survive a reload?** Refresh mid-flow and see whether the app comes
back sensibly.

---

## Things worth knowing about the sandbox

- It runs **merged but unreleased** code. It will sometimes be broken - that is
  what it is for.
- Its data is **demo data and gets wiped**. Do not put anything real into it,
  and do not rely on anything you created still being there tomorrow.
- It is **public**. Assume anything you type can be read by anyone.
- It shares nothing with real shops - its own database, its own secrets, no
  route to anything a customer uses.

---

## What happens after

Work that has been tested gets promoted from `develop` to `main` as a single
release pull request, which the maintainer reviews and merges. Tagging `main`
is what builds the installers and publishes the release.

Release notes are generated from the merged pull requests, so **your name
appears in them** — for the change you wrote, and the release you helped test
is one somebody could trust because you did.
