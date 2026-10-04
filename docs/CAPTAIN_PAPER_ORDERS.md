# Captain paper orders

Paper orders are opt-in on Settings → Captain App → Paper orders. They use AWS
Textract DetectDocumentText for English handwriting. Captain keeps a local draft,
allows cropping and review, then submits through the existing durable order queue.
The original photo is saved before recognition and its reference is written with
the sale. No recognition result directly creates a kitchen order.

Existing orders can also receive reference-only photos through
`POST /captain/v1/paper-orders/reference` with `id`, `saleId`, and `original`.
This option uses the same opt-in setting and private storage, but does not call
Textract or change sale items, money, or payment status. Identical retries reuse
the saved upload and attach it only once. The photo cannot be rebound to another
order. Captain and desktop sale details show the scan and additional references.

## Server setup

- Set AWS_REGION to a Textract-supported region, for example ap-south-1.
- Set ORDER_PHOTO_BUCKET to a dedicated private S3 bucket in that region.
- Enable all four S3 Block Public Access settings. Do not reuse the public menu
  image bucket. Do not enable public ACLs or public bucket policies.
- Give the server IAM role textract:DetectDocumentText and s3:PutObject /
  s3:GetObject on that bucket's orders/* objects. Use the AWS SDK credential chain;
  no keys are stored in Captain or returned by the settings endpoint.
- ORDER_PHOTO_MONTHLY_LIMIT defaults to 3000 attempted photo uploads/scans per branch per UTC
  calendar month. Failed attempts count; completed identical retries use the saved
  result and do not call AWS again. Monitor AWS billing separately.
- The endpoint must be deployed to the server Captain connects to. A desktop
  without AWS configuration does not advertise photo recognition.
- Lightsail installations without an instance role can use dedicated
  ORDER_PHOTO_AWS_ACCESS_KEY_ID and ORDER_PHOTO_AWS_SECRET_ACCESS_KEY credentials.
  Store these only in the server environment or GitHub Secrets. They override
  credentials for paper orders only, leaving public menu storage unchanged.

Set storage retention deliberately. Sale photos are retained; there is no automatic
deletion of attached photos. Abandoned drafts also leave private objects and should
be considered when setting storage budgets. Do not apply a short bucket lifecycle
policy to all order photos: it would also remove sold-order references.

## Data and access

The database stores the private object key and an authenticated application URL,
not a public URL or an expiring signed URL. Photo reads enforce the signed-in shop
and branch. Draft photos additionally require the creating user; sale photos use
sales access. A photo can bind to only one order idempotency key.

New sales through the central model/native writers capture request origin where
available: authenticated actor, server-observed IP, user agent, branch and time.
Captain's existing client metadata also retains device/app details. No precise GPS
location is collected or inferred. Existing historical sales are not backfilled.

## Validation

Run the focused API paper-order and sale-origin tests and Captain paper-order
browser tests. AWS is mocked in those tests. Before enabling for a customer, verify
the real IAM role, bucket privacy, a real handwritten sample and photo retrieval.
No production sale is necessary for recognition validation.

For an opt-in live service check, set `CAPTAIN_LIVE_AWS_CHECK=1`, `AWS_REGION`,
`ORDER_PHOTO_BUCKET` and an AWS SDK credential profile, then run
`node tests/paper-order-live.cjs path/to/sample.png` from `api`. The PNG should
contain `T4 P5`, `CB 5`, `MB 2`, and `PBM 1`. This check uses an isolated MongoDB,
verifies bucket privacy, recognition, retry reuse, photo retrieval and ownership,
then deletes its own S3 object. It incurs one Textract request. A generated font
sample verifies integration only; use real handwritten samples for quality
acceptance and verify the deployed application's IAM identity separately.
