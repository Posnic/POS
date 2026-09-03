# App review checklist

Use this checklist when reviewing a proposed external app or connector.

This checklist is documentation only. It does not approve real third-party apps,
enable network access, or claim support for any provider. Community Edition must
remain fully functional offline.

## Review boundary

Use synthetic examples only.

Do not include:

- Live API keys, tokens, passwords, or provider credentials
- Real customer names, email addresses, phone numbers, addresses, or photos
- Payment, card, bank, tax, invoice, settlement, or payroll data
- Production database exports, logs, screenshots, or configuration files
- Claims that a provider or connector is supported before it is tested and accepted

A review must state whether the app remains disabled by default and whether it
can be used without sending shop data outside the local machine.

## Required information

Every app submission must include the following information:

| Review item | What the submission must state |
|---|---|
| App purpose | The specific workflow the app improves |
| Requested scopes | Every permission requested and why it is needed |
| Support contact | A monitored support email address or issue tracker |
| Data deletion | How a shop requests deletion and what data is deleted |
| Permission copy | Plain-language text shown to the shop before consent |
| Security notes | Storage, transmission, authentication, and failure behavior |
| Offline behavior | What works when the app is disabled or the network is unavailable |

Reject a submission when any required information is missing, vague, misleading,
or unsupported by the implementation.

## Passing synthetic example

### Submission

**App name:** Inventory Export Helper

**Purpose:** Exports a shop-selected inventory report as a CSV file that the
shop downloads locally.

**Requested scopes:**

- `inventory.read` - reads product name, SKU, stock quantity, and category for
  the report selected by the shop.
- `files.write` - writes the generated CSV only to a location chosen by the
  shop.

**Support contact:** `support@example.invalid`

**Data deletion:** The app stores no customer, product, or transaction data
outside the local device. Generated CSV files remain under the shop's control.
The shop deletes an exported file using its operating system.

**Permission copy shown to the shop:**

> Inventory Export Helper can read your inventory records to create a CSV file
> on this device. It does not send your shop data to an external service. You
> choose where the CSV is saved.

**Security notes:**

- The app is disabled by default.
- It does not require an API key, account, token, or external provider.
- It makes no network requests.
- It writes only after the shop chooses an export location.
- If writing the file fails, it reports the error and does not retry elsewhere.

**Offline behavior:** The app works offline because it reads the local inventory
and writes a local file.

### Approval rationale

**Pass.** The requested scopes are limited to the stated workflow. Permission
copy is clear, support contact is present, deletion is straightforward, and the
app does not send shop data outside the device. The example uses synthetic
information only and makes no unsupported provider claim.

## Rejected synthetic example

### Submission

**App name:** Smart Sales Insights Cloud

**Purpose:** Sends sales data to a cloud service to generate recommendations.

**Requested scopes:** `all_data`

**Support contact:** "Contact us if needed."

**Data deletion:** "Data is kept as needed."

**Permission copy shown to the shop:**

> Enable Smart Sales Insights Cloud for better recommendations.

**Security notes:** "The service is secure."

**Offline behavior:** Not described.

### Rejection reasons

**Reject.** This submission must not be approved because:

- `all_data` is not a specific or least-privilege scope.
- It does not identify what shop data leaves the device.
- It does not provide a usable support contact.
- Its deletion policy is vague and does not explain how a shop requests deletion.
- Permission copy does not explain data sharing, scopes, or the consequence of
  granting consent.
- Security notes do not describe authentication, encryption, storage, or
  failure behavior.
- Offline and disabled behavior are not described.
- The submission implies cloud-provider behavior without evidence that the
  connector has been reviewed, tested, and accepted.

The contributor must provide a revised design and obtain review before building
or enabling any external integration.

## Reviewer decision

Before approving a submission, confirm all statements below:

- [ ] The example contains synthetic data only.
- [ ] Every requested scope is named and justified.
- [ ] The support contact is usable and monitored.
- [ ] The deletion process is clear and actionable.
- [ ] Permission copy is understandable before consent is granted.
- [ ] Security notes explain storage, transmission, authentication, and failure behavior.
- [ ] Offline and disabled behavior are documented.
- [ ] The submission makes no unsupported provider-support claim.
- [ ] The default local app continues to work without external services.