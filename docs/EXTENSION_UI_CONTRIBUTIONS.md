# Extension UI contributions v1

Extensions declare presentation in their signed `extension.json`. This follows
the declarative contribution pattern documented by
[VS Code](https://code.visualstudio.com/api/references/contribution-points),
within POSNIC's existing authenticated extension page boundary.

```json
{
  "requiredCapabilities": ["namespace.commands.v1", "ui.contributions.v1"],
  "contributes": {
    "menu": "inventory",
    "page": { "header": "extension" }
  }
}
```

`menu` can be `sales`, `inventory` or `manage`. It places the extension's existing
namespaced page beside the corresponding host navigation. Unknown locations have
no effect. A package without a signed UI has no menu contribution. The legacy
`menu: "sales"` declaration remains supported.

The host always builds `#/extensions/<encoded-extension-id>` itself. Extensions
cannot replace `/sales`, register arbitrary host routes, supply remote menu URLs,
choose DOM selectors or inject executable menu handlers. Labels are inserted as
text. Internal tabs remain within the extension's isolated page; arbitrary
top-level routes and multiple contributed pages are not implemented by v1.

`page.header` defaults to `host`. Choosing `extension` lets the signed page render
its own heading, avoiding a duplicate host title. Other page keys and invalid
values are rejected by the verified loader. Normal host presentation is restored
when another extension page opens. Embedded sales workspace presentation retains
its existing separate contract.

The server lists only installations the current actor can read. Navigation is
removed before refreshing; responses from a previous branch or refresh are
discarded. Page and command requests continue through existing signature,
installation, actor and branch authorization. A navigation contribution grants
no database, network, stock, payment or staff permission.

Declare `ui.contributions.v1` when using the new menu locations or page settings.
Older hosts reject a package requiring that capability before activation. Ship
the host API and frontend support in a normal platform release before extensions
require it; installing an extension must not patch the frontend. This is a
generic platform capability, not a per-client POSNIC fork.

Data/sync: contributions are immutable signed package metadata, not mutable shop
business records. Existing installation grants control each tenant/branch.
Package distribution and capability verification must also occur on tills before
activating a package there. This change adds no sync collection and schedules no
business effects. Real till upgrade acceptance is still required separately.

Local coverage: menu placement, safe labels, disabled/unknown contributions,
branch-change races, revoked navigation, page reset, signed loading and rejection
by a host missing the capability. These checks do not establish independent
HKTVmall connector storage or deployment readiness.
