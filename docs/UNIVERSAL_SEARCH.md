# Universal search

Open Search beside Add in the POS header, or press Ctrl/Cmd+K. Search uses the current shop, staff permissions, active branch and effective module settings. Opening a create result navigates to the normal form. Submitting the form remains an explicit action.

## Adding a route or setting

Use the normal translated sidebar or Add-menu link, with the destination module and permission. The palette reads the menu labels, their routes and the link visibility rules. For a setting, put a label with a matching for/id on its control in the owning settings pane. The pane route and label are indexed together. For a destination that has no menu link, register it in the command palette with its permission, destination and useful aliases. Operations that change data must still use the destination's own authorization and submit flow.

View, show, open, list and browse use the same action. “View sales” opens Sales History. “Add sale” opens New Sale. Each permitted menu destination and indexed settings control contributes its label to the action index. Use data-search-aliases="phrase one|phrase two" on the route link or control for additional operator wording. Extension search pages contribute their labels and keyword phrases with their declared open or create action. The matcher folds the action and object words independently. Add, new and create share a term. Sale and sales share another, so all six phrases work automatically. Extra words can appear in either order. Declare genuinely different operator terms (for example, vendor and supplier) in the vocabulary once. Keep the original input for identifier lookup so leading zeros and configured bill series survive.

Adding a record type requires its display field, exact fields, name fields if needed, read ACL, branch sharing and deletion rules, plus a real detail route. Review the MongoDB query plan and add a versioned migration for newly required indexes. Never add keys to a previously shipped migration.

## Search inside an extension

The host already searches the installed extension's launch destination. To expose a specific page or record, a verified package can declare a search array in its signed extension.json metadata. The following example provides a setup page and one destination per repair ticket.

~~~json
{
  "contributes": {
    "search": [
      { "target": "preferences", "label": "Repair settings", "keywords": ["service setup"] },
      { "target": "ticket", "label": "Repair ticket", "records": "tickets", "id": "reference", "title": "summary" }
    ]
  }
}
~~~

Here tickets is a top-level array in the extension's own branch namespace. Each entry supplies a stable reference such as SR-12 and its authorized display title. Expose only fields that all staff with this extension's read permission may see. A static create-form destination can declare action equal to create. A package can declare up to 12 destinations. The host validates field names, destination IDs, package digest, install state, branch and read permission.

On selection the host opens the verified package view. Its existing posnic-extension-connect message includes an optional searchDestination object such as {"target":"ticket","id":"SR-12"}. The package should navigate to that record, or handle it having disappeared. A static destination receives id equal to page. Opening a result carries no command or write authorization.

## Verification

The DOM regression test uses the real menu and settings templates. The API integration test exercises two isolated MongoDB databases, branch filtering, mobile number formatting, feature permissions, extension disablement, paging and clear-history retries. Run node --test tests/universal-search.test.js and node --test api/tests/universal-search.integration.cjs with their repository dependencies installed. The latter uses mongodb-memory-server and supports MONGOMS_SYSTEM_BINARY for a local MongoDB executable.
