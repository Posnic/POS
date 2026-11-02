# Agent rules

Posnic credits people, not software tools.

- Do not add an AI assistant, agent, model, bot, automation, coding tool, or
  generated-by footer as an author, contributor, co-author, reviewer,
  maintainer, credit, DCO sign-off, changelog credit, release-note credit,
  README credit, package metadata identity, issue attribution, or pull-request
  attribution.
- Commit trailers and project metadata must identify the human contributor
  only.
- Remove assistant signature footers before committing.
- If a maintainer asks for provenance, describe tool use in the pull-request
  body as implementation context, not contributor attribution.
- Run `npm run check:attribution` before opening a pull request.

## Where a setting goes

The Features list is a row of switches. A shopkeeper scans it to see what is
on and what is off, and that is the only question it answers.

- **Never put a setting in a Features card.** Not a dropdown, not a text
  field, not a Save button. A card carrying controls is twice the height of
  its neighbours and breaks the grid it lives in, and the person scanning for
  "is Captain on" now has to read past a form to find out.
- **Every setting belongs on its own module's page.** Tax, Marketing,
  Messaging, Kiosk, Captain App and the rest each have one. Add a tab to that
  page rather than a control to the switch.
- **A module with no page yet needs a page, not an exception.** That is a
  larger change than squeezing the control in somewhere, and it is the correct
  one.
- **Do not file a setting by how it is built.** A voice provider is not an
  "integration" because it holds an API key, any more than SMTP is. It is a
  captain app setting, and it goes where somebody would look for it: the page
  of the thing it belongs to.

Integrations is for what genuinely faces outward on its own - API tokens,
webhooks, signed connectors, the shop's own analytics property - not for any
feature that happens to call somebody else's API.


## Local verification and CI costs

GitHub Actions spending is constrained. Prefer local verification.

- Run relevant tests, lint, packaging checks and attribution checks locally
  before pushing. Report the commands, results and anything not verified.
- Do not create GitHub Actions workflows or add CI jobs, matrix entries,
  scheduled runs, runners or broader triggers unless the user explicitly
  requests that CI expansion. A feature or bug-fix request is not authorization.
- Keep regression tests in the repository and run them locally, including
  Windows-specific printer checks on Windows. Removing a workflow does not
  mean removing its tests.
- Batch changes and push after local checks pass. Do not repeatedly push or
  rerun unchanged CI jobs for experimentation; reproduce failures locally.
- Preserve existing required checks and security protections. Do not disable
  them or bypass branch protection without explicit user authorization.

## Optional features

Optional workflows and behaviors must default off and require explicit opt-in in their module's settings. Server capability support alone is not user consent. Preserve explicitly saved settings on upgrades. Do not introduce automatic workflow transitions such as table cleaning. Keep duplicate prevention, durable order recovery, payment integrity, authentication and access checks automatic. Document default changes and test both unset and explicitly enabled settings.

## Sync is part of every data feature

A feature is not complete just because it works in the web app or on one till.
For every new feature, bug fix, collection, persisted field, setting, or change
to a write/delete path, review synchronization before implementation is called
complete. This applies to API routes, helpers, workers and desktop code as well
as models, repositories, services and controllers.

- Identify all data the feature reads and writes, its tenant/branch scope, and
  which installation is authoritative. State what users must see on the web,
  on the originating till and on another authorized till, including offline
  operation and reconnection.
- Configure shared business data end to end in the same delivery: POS
  `api/src/sync/collections.json`, Gateway
  `apps/sync-gateway/src/collections.js`, and the sync agent's
  `apps/sync-agent/sync-config.json`. Check names, scopes, transport behaviour
  and the agent actually bundled or installed on the till. If existing lanes
  already cover a field, verify that explicitly; do not add redundant lanes.
- Verify stable identifiers, tenant/branch access, timestamps/checkpoints,
  conflict handling, deletions/tombstones and referenced files such as images
  and attachments. Updating a collection list alone is not sufficient.
- Never leave newly introduced or changed business data as `undecided` and
  treat the feature as finished. Review existing exclusions when extending a
  feature; an old exclusion is not proof that the current behaviour is right.
- Intentional local-only data needs a concrete reason and a defined user
  experience. Credentials, sessions, execution leases, printer queues and
  payment/stock command journals must not be blindly replicated. When users
  need cross-installation visibility, provide a read-only shared view or an
  authenticated request to the authoritative server. Do not replay schedules,
  payments, stock movements, messages or print jobs on another installation.
- Test the feature's required directions: cloud to till, till to cloud, and
  other authorized tills where applicable. Cover create/update/delete,
  reconnect/retry, duplicates, branch isolation and existing-data migration or
  backfill. Check files separately from their database references. A passing
  classification test or matching manifests does not prove delivery.
- Include the sync decision, related Gateway/agent changes, rollout order and
  test evidence in the PR or handoff. Do not claim the feature is deployed or
  ready for clients until required Gateway/API/agent changes and the intended
  installer are available together. State any unverified live-device behaviour
  or remaining gap explicitly; do not hide it behind passing local tests.

Apply this review using existing local checks and regression tests. This rule
is not permission to add CI jobs, bypass branch protections, or change security
and access controls without the authorization otherwise required above.

## Private components and release distribution

- A request to build, sign, publish, or send a POS installer does not authorize
  copying or distributing private repository contents. Build success, access
  to a private checkout, and a "separately licensed components" notice are not
  redistribution permission.
- Public POS installers and customer support builds must use the documented
  public-build path. Do not copy Gateway/Intranet source, including the private
  sync agent, into POS source, build resources, archives, or release assets.
  Cloud components remain under the separate authenticated, signed delivery
  mechanism managed by the private infrastructure after cloud activation.
- Do not set SYNC_AGENT_DIR to a private checkout or rely on sibling-directory
  auto-discovery for a public/customer build. Check for stale private files in
  builds/sync-agent and output resources before packaging. Never resolve a
  packaging failure by fetching or copying private code into the artifact.
- Any exception requires explicit user authorization naming the component,
  permitted contents, recipients, and distribution channel. Stop and clarify
  if the approved boundary is unclear; do not infer it from packaging support.
- Before uploading, inspect the actual installer/archive contents, including
  unpacked resources and nested archives. Verify the absence of private source,
  credentials, customer data, local logs, and unapproved components. Excluding
  .env alone is not a sensitive-file audit. Record what was inspected.
- Verify repository visibility and download audience before publishing. A
  prerelease on a public repository is public; an unadvertised URL is not an
  access restriction. Sharing with one customer does not authorize public
  distribution of private materials.
- If an unauthorized artifact is discovered, stop further distribution,
  preserve local evidence without republishing sensitive content, and report
  the exact release, contents, and known download count. When removal is
  authorized, withdraw it promptly and verify that its download is unavailable.
  Do not claim that withdrawal retracts downloaded copies or that credentials
  were absent without inspecting the artifact.
- Sync compatibility review does not override these distribution rules. Review
  the separately delivered agent without embedding its private source in POS.
