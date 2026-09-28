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
