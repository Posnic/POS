# Email provider setup

Messaging > Settings > Email separates the sending account from the receipt and report choices. Choose a provider, complete its setup, save, then use **Send test email**. A provider accepting a request is not proof of inbox delivery. Check the recipient inbox/spam and provider delivery logs.

## Supported connections

| Provider | Connection | Default / requirements |
| --- | --- | --- |
| Posnic cloud email | Managed platform service | Existing platform transport; no shop key required |
| Gmail / Google Workspace | SMTP | smtp.gmail.com, 587 STARTTLS; full email address and app password |
| Outlook.com / Hotmail / Live | SMTP with OAuth | smtp-mail.outlook.com, 587 STARTTLS; delegated Microsoft app credentials and refresh token |
| Microsoft 365 | SMTP with OAuth | smtp.office365.com, 587 STARTTLS; SMTP AUTH enabled for mailbox and app consent |
| Yahoo | SMTP | smtp.mail.yahoo.com, 587 STARTTLS; app password |
| iCloud | SMTP | smtp.mail.me.com, 587 STARTTLS; app-specific password |
| Zoho | SMTP | smtp.zoho.com, 587 STARTTLS; confirm region/account-specific host |
| Brevo | SMTP or API | smtp-relay.brevo.com; SMTP login/key differ from API key |
| SendGrid | SMTP or API | smtp.sendgrid.net; SMTP username apikey; Mail Send key; global API endpoint |
| Postmark | SMTP or API | smtp.postmarkapp.com; server token or SMTP access key/secret; transactional outbound stream |
| Resend | SMTP or API | smtp.resend.com; SMTP username resend; sending API key |
| Amazon SES | SMTP | Copy regional endpoint and SES SMTP credentials; sandbox restricts recipients |
| Hostinger Email | SMTP | smtp.hostinger.com; other Hostinger mail products may use different servers |
| Shared hosting / cPanel / Plesk | SMTP | Copy secure settings from hosting control panel; no guessed host |
| Other provider | SMTP | Editable host, port and encrypted connection |

Only the four listed email API adapters are implemented. Microsoft uses SMTP OAuth, not Graph. A self-service Microsoft sign-in/consent wizard is not included: an administrator must supply the delegated app credentials. Provider trial restrictions, account approval, quotas and sending policies still apply.

## Ports and verification

- 587 normally uses STARTTLS; 465 uses implicit SSL/TLS. Posnic requires encrypted connections for new SMTP configurations.
- 2525 is an alternative only where the provider supports it. SES also supports 2587 STARTTLS and 2465 SSL/TLS. Port 25 is often blocked and is not the default.
- Verify the From address/domain. Publish the SPF/DKIM/DMARC records specified by your provider; do not invent or duplicate SPF records.
- Brevo: open SMTP & API for the correct key. If unknown-IP blocking is active, approve the server in Authorized IPs or its approval email. An API key is not an SMTP password.
- SendGrid: if IP Access Management is enabled, allow the sending server's public outbound IP.
- Allowlist the API server/NAT public IP that makes the connection, not the user's browser IP. Independent local senders can have a different outbound IP. Ask the server administrator for the correct address.
- SMTP/API authentication failures never switch an explicitly configured account to another provider.

## Official setup references

- [Google app passwords](https://support.google.com/accounts/answer/185833)
- [Microsoft SMTP OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Outlook.com SMTP settings](https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com)
- [Yahoo SMTP](https://help.yahoo.com/kb/SLN4724.html)
- [iCloud SMTP](https://support.apple.com/en-us/102525)
- [Zoho SMTP](https://www.zoho.com/mail/help/zoho-smtp.html)
- [Brevo SMTP](https://developers.brevo.com/docs/smtp-integration) and [SMTP keys / authorized IPs](https://help.brevo.com/hc/en-us/articles/7959631848850-Create-and-manage-your-SMTP-keys)
- [Brevo email API](https://developers.brevo.com/reference/send-transac-email)
- [SendGrid SMTP](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/integrating-with-the-smtp-api) and [email API](https://www.twilio.com/docs/sendgrid/api-reference/mail-send)
- [Postmark SMTP](https://postmarkapp.com/developer/user-guide/send-email-with-smtp) and [email API](https://postmarkapp.com/developer/api/email-api)
- [Resend SMTP](https://resend.com/docs/send-with-smtp) and [email API](https://resend.com/docs/api-reference/emails/send-email)
- [SES ports](https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html)
- [Hostinger settings](https://support.hostinger.com/en/articles/1575756-how-to-get-email-account-configuration-details-for-hostinger-email)
- [cPanel mail client setup](https://docs.cpanel.net/cpanel/email/set-up-mail-client/)

## Storage, migration and synchronization

New settings live in `messaging_settings.email_config`, scoped by license and branch. That collection is already explicitly local-only in `api/src/sync/collections.json`; no Gateway or agent lane is added. Credentials and execution authority must not be copied to tills or other branches. A web client and tills using the same API read the same redacted configuration. An independent local API retains its own sender configuration. Offline devices cannot send through a cloud provider; reconnecting does not replay a send automatically.

If no email_config exists, the resolver uses the previous branch SMTP/platform configuration. Saving through the new screen adopts the email fields into the local messaging authority. It does not erase the legacy branch record. Blank secret fields preserve saved secrets for the same provider; changing providers clears old credentials unless replacements are supplied. Keys and tokens are never returned to the browser. Switching to Posnic cloud email explicitly bypasses the saved shop SMTP settings.

Receipts, purchase PDFs, scheduled summaries and captain email verification use the configured resolver. Platform welcome/password-reset messages remain platform-owned. Existing schedules are unchanged. API submission timeouts are uncertain, not automatic retries. API send adapters require an acknowledgement ID and support in-memory PDF attachments.

## Validation and rollout

Run the provider UI tests, shop-email unit tests, email transport contract tests, scheduled-report SMTP loopback tests, and messaging/captain tests. UI checks cover desktop and narrow layouts. Provider API tests use synthetic HTTP responses; they do not prove delivery from real accounts. Live provider credentials, Microsoft consent, recipient confirmation and physical till/reconnect checks remain separate deployment checks.

Deploy API routes and transport changes with the matching frontend bundle. Do not deploy only the selector: older servers do not expose messaging/email. On load failure the screen keeps Save disabled instead of replacing an unknown configuration.
