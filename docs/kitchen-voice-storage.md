# Captain voice recording storage

General kitchen messages now use authenticated `kitchen-audio/archive`, `recordings` and `playback` actions. The archive is separate from the local speaker queue: saved does not mean broadcast or played. A failed local delivery leaves the archived recording available and preserves the original retry identity.

## Deployment

Deploy the Captain API changes before the new client send flow. Existing local speaker delivery still requires Kitchen Sound / kitchen talk to be enabled on the branch POS. This change does not implement a cloud-to-local speaker relay. Cloud uploads and staff replay work without a local process; broadcasting still requires connecting to the local POS.

Set `KITCHEN_VOICE_BUCKET` to a **private** bucket, or reuse the configured private `ORDER_PHOTO_BUCKET`. Do not use the public menu-image bucket. AWS uses `AWS_REGION` and its standard credential chain. For an S3-compatible cloud provider, set `KITCHEN_VOICE_ENDPOINT`, `AWS_REGION`, `KITCHEN_VOICE_ACCESS_KEY_ID` and `KITCHEN_VOICE_SECRET_ACCESS_KEY` on the server. These credentials are never sent to Captain. For local installations without a bucket, recordings are stored in the server database.

Allow only PutObject/GetObject on the `kitchen-voice/` prefix. Keep public access blocked. Configure a bucket lifecycle rule to expire that prefix after seven days; database TTL removes metadata after seven days. Without the lifecycle rule, inaccessible objects remain in storage. Captures are available to the original authenticated staff member in the original shop and branch. History shows up to 50 recent messages; at most 100 retained messages per scope. Upload limit is approximately 1 MB.

## Verification

Mongo-backed tests cover retry deduplication, owner isolation, expiry, malformed media, upload failure and private object replay. S3 SDK is mocked in these tests. Browser tests cover narrow/tablet layouts, restored draft, replay after reload, unchanged kitchen retry identity and account-switch protection. Actual provider credentials, speaker hardware, real Android/iOS recording and deployed cloud delivery are not verified by these tests.
