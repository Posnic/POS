<!--
  Base this on `develop`, not `main`.

  develop is where contributions land and where they are tested; main is
  released code. If you opened this against main, you can change the base
  branch with the "Edit" button next to the title - no need to redo the work.
-->

## What does this PR do?

<!-- Short description; link the issue it addresses: Fixes #123 -->

## Acceptance criteria covered

<!-- List the issue checklist items or PR slice this closes. If one is not
     finished, say why so reviewers do not have to guess. -->

- [ ] Linked issue has clear acceptance criteria, or this PR adds them first
- [ ] This PR completes the listed criteria or names the remaining work

## How was it tested?

- [ ] Ran locally (`npm start` for the desktop app, or `npm run dev` for a browser at http://localhost:3000)
- [ ] Built the installer (`npm run build`) if build/packaging was touched
- [ ] Relevant tests pass
- [ ] Used the relevant checks from [`docs/CONTRIBUTOR_QUICKSTART.md`](../docs/CONTRIBUTOR_QUICKSTART.md#test-the-right-thing)

## Checklist

- [ ] One focused change per PR
- [ ] Only people are credited as authors/contributors; no AI tool attribution or signature footer is included
- [ ] Commits are signed off (`git commit -s`, DCO)
- [ ] Works fully offline (no new external network calls in the local edition)
- [ ] Matches surrounding code style
- [ ] No real customer, tax, payment, credential, token, or production data is included
