# Release runbook

How a release goes out, and how to take one back.

This exists because the second half is the half nobody writes down. Shipping is
rehearsed every time; undoing a bad release is attempted once, under pressure,
by whoever is available.

---

## What a version number means

`MAJOR.MINOR.PATCH`, plain semver. The tag carries a `v`; the version inside
`package.json` never does.

| Change | Version | What the shop sees |
|---|---|---|
| Electron, Node, a native module, bundled MongoDB | **major** `x.0.0` | Waits on the Updates screen until the shop starts it |
| Our features | **minor** `1.x.0` | Downloads quietly, installs when the till is closed |
| Our fixes | **patch** `1.0.x` | Downloads quietly, installs when the till is closed |

**Reserve the major for the platform.** Not for "this feels like a big
release". `update-service.js` classifies a major as a core update and makes the
shop choose the moment, because that is a real download and a real restart.
Everything else applies itself when the till closes for the day.

The version must stay three plain integers. `parseInt('R14')` is `NaN`, and an
unreadable version classifies as core - so a prefix in `package.json` silently
stops automatic updates for everyone, with no error anywhere.
`tests/release-version-format.test.js` fails if that ever happens.

---

## Releasing

1. **Land everything on `main`** and let CI go green. Release re-runs the same
   checks, so a red `main` is a red release.

2. **Bump the version** in `package.json`. One commit, nothing else in it.

3. **Write the release notes before tagging.** They appear in the Updates window
   inside the application - a shop that has turned automatic updates off reads
   these to decide whether to install. Write for a shopkeeper, not a developer:
   what changed for them, and anything they must do differently.

4. **Tag and push.**
   ```
   git tag v1.4.0
   git push origin v1.4.0
   ```

5. **`release.yml` takes over.** It re-runs CI, builds Windows, macOS and Linux,
   checksums everything, and creates the release **as a draft**.

6. **Check the draft before publishing.**
   - The installers are all there and the sizes look sane
   - `SHA256SUMS.txt` is present
   - **`latest.yml`, `latest-mac.yml` and `latest-linux.yml` are present.** These
     are what an installed till reads to discover the release exists. Without
     them the release looks perfect and no shop is ever offered it - the Updates
     window reports that it cannot reach the update server, which reads as a
     network fault rather than a missing file. `tests/release-manifest.test.js`
     pins the workflow that produces them, but only looking proves it happened.
   - The release is **not** marked pre-release, unless you mean it. A
     pre-release is invisible to every installed copy, because `allowPrerelease`
     is false. That is the right default for an unsigned beta and the wrong one
     for a release you want shops to get. It is controlled by the
     `POSNIC_PRERELEASE` repository variable, not by the workflow.
   - The notes read the way you want them read inside the app
   - On Windows, the installer is signed:
     ```
     Get-AuthenticodeSignature Posnic-Setup-1.4.0.exe
     ```
     `Status` must be `Valid`. **`NotSigned` means stop** - see below.

7. **Publish.** Every installed till finds it at its next check.

8. **Update the download page.** `download.html` in the `web-frontend` repository
   carries the version in every link, every filename and every size, because
   GitHub's asset URLs contain the version and there is no "latest" form of them
   that works.

   The page repoints itself from the GitHub API on load, so a visitor with
   JavaScript gets the newest release whatever the markup says. That is a
   safety net, not the fix: the links in the file are what a search engine
   indexes, what someone with a blocked API request gets, and what the page
   falls back to when the rate limit is hit. Bump them anyway.

   Check each link resolves before you walk away:

   ```
   grep -oE 'https://github\.com/Posnic/POS/releases/download/v[0-9.]+/[A-Za-z0-9._-]+' download.html |
     sort -u | while read u; do
       echo "$(curl -s -o /dev/null -w '%{http_code}' -L -r 0-99 "$u")  ${u##*/}"
     done
   ```

   Every line must read `206`. A ranged `GET` is used rather than `HEAD`, which
   GitHub answers unreliably for release assets and will report `404` for files
   that are plainly there.

   This step is last and it is the one that gets skipped, because the release
   itself is already done and working by then. A stale download page does not
   break anything visibly - it just quietly hands every new shop the previous
   version, and nothing anywhere reports that.

### If the build fails

`release.yml` accepts a tag through `workflow_dispatch`, so a failed release can
be re-run against the same tag once the cause is fixed. Do not delete and
re-push a tag that a shop may already have seen.

---

## Signing

Until a code signing certificate is configured, `Get-AuthenticodeSignature`
reports `NotSigned` on every installer.

The build log is not evidence either way. It prints

```
• signing with signtool.exe  path=dist\Posnic-Setup-1.4.0.exe
```

whether or not a certificate exists - that line is the attempt, not the result.
Check the signature itself.

`verifyUpdateCodeSignature` stays `false` while builds are unsigned. Turning it
on before there is a signature to verify does not harden the update chain; it
makes every update fail. The order is: certificate, then a `Valid` signature
checked on a machine that did not build it, then enable verification, then prove
an update applies end to end.

---

## Rolling back

Three different things can be rolled back, and they are not equally hard. Work
down this list - the first one that applies is the cheapest.

### 1. A bad frontend asset update - seconds, no network

*Updates screen → **Go back to the previous version**.*

A pointer move and a restart. It works with no internet, which matters because
the machine that needs it most is often the one that cannot reach you. Only
application files change; sales, items, customers and settings are untouched.

A version that fails to boot twice reverts itself without anyone asking.

### 2. A bad release, before most shops have it - minutes

**Unpublish the GitHub release** (back to draft, or delete it). Tills check the
latest published release, so an unpublished one stops being offered
immediately. Shops that already downloaded it still have it staged - fix
forward for those.

This is why releases are drafted rather than published automatically: the
window where this is cheap is the window before you publish.

### 3. A bad release already installed - a reinstall

There is no automatic downgrade. `electron-updater` is an upgrade path;
pretending otherwise would mean an untested code path running at the worst
possible moment.

The supported route, and what support should walk a shop through:

1. In the application: *Updates → Update settings →* turn **Check for updates
   automatically** off. Skipping this means it updates straight back again.
2. *Updates → Going back to an earlier release → **Open the releases page***.
3. Download the previous version's installer.
4. Run it. Install over the top; do **not** uninstall first.
5. Confirm the version in *Updates*, and that recent sales are present.
6. Leave automatic updates off until the replacement release is out.

**Installing over the top keeps the data.** `AppData\Roaming\posnic` -
the database, credentials, API runtime - and `Documents\Posnic-Backups` are not
touched by the installer. Uninstalling first is what puts data at risk, and it
is the step people improvise when there is no runbook. That is why it is written
here.

### 4. Data damaged by a release - restore

*Backup Manager → History* → pick the backup taken immediately before the
update. Every update takes one first: a forced backup runs before the installer
is handed control, and if that backup fails **the update is cancelled** rather
than applied.

So there is always a backup from immediately before the version that broke
something. That is the point of it.

---

## After a rollback

- Say what happened in the next release notes. A shop that rolled back needs to
  know the replacement is safe, and "various fixes" does not tell them.
- Add the case to the test suite before fixing forward. A release that broke
  something once with no test is a release that can break it again.
- If shops were told to turn automatic updates off, the next release notes must
  tell them to turn it back on. Nobody remembers on their own, and a till that
  silently stopped updating is a till running last year's build.

---

## Before publishing installers publicly

Not yet done, and each one blocks a public binary release:

- [ ] Code signing certificate obtained and configured
- [ ] `Get-AuthenticodeSignature` reports `Valid` on a clean machine
- [ ] `verifyUpdateCodeSignature` set to `true`
- [ ] `publish.private` set to `false`
- [ ] An update proven to apply end to end, from an older installed version
- [ ] Install, upgrade and rollback smoke-tested on a clean Windows machine
- [ ] Backup and restore verified on a clean machine
- [ ] Hardware support matrix published
