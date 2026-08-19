/*
 * The one place that talks to S3.
 *
 * Three files used to build their own client with `require("aws-sdk")` - AWS
 * SDK v2, which package.json has never declared and which reached end of life
 * in 2025. The require sits inside the upload branch rather than at the top of
 * the file, so the modules load fine and nothing complains until a shop
 * actually switches storage to S3 and uploads an item image. Then it throws
 * "Cannot find module 'aws-sdk'" and returns a 500 with no useful message.
 *
 * @aws-sdk/client-s3 - v3 - was already declared and already in use in
 * sms.service.js, so the fix was to use the SDK this project had chosen rather
 * than install a dead one.
 *
 * One behavioural note. v2's `upload()` resolved with a `Location`, and the
 * controllers return that URL to the browser. v3's PutObjectCommand returns no
 * such field, so uploadObject builds it - which means the URL is now
 * constructed from the bucket and region rather than reported by AWS. For the
 * standard bucket-in-region case they are the same string. A custom endpoint,
 * an accelerated transfer or a CNAME in front of the bucket would differ, and
 * AWS_S3_PUBLIC_URL is the override for exactly that.
 */

const fs = require('fs');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

let client = null;

/* Read the environment inside the function, not at module scope. main.js sets
   several of these after this file may already have been required. */
function s3Config() {
  return {
    bucket: process.env.AWS_S3_BUCKET,
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    publicUrl: process.env.AWS_S3_PUBLIC_URL,
  };
}

function getS3Client() {
  if (client) return client;
  const cfg = s3Config();
  client = new S3Client({
    region: cfg.region,
    credentials:
      cfg.accessKeyId && cfg.secretAccessKey
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined,
  });
  return client;
}

/* Exposed so tests can drop a client the module built earlier. */
function resetS3Client() {
  client = null;
}

function publicUrlFor(key) {
  const cfg = s3Config();
  const encoded = String(key).split('/').map(encodeURIComponent).join('/');
  if (cfg.publicUrl) {
    return `${cfg.publicUrl.replace(/\/+$/, '')}/${encoded}`;
  }
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${encoded}`;
}

/*
 * Returns the shape the v2 call used to return, so callers reading `.Location`
 * keep working.
 */
async function uploadObject({ key, filePath, body, contentType, acl }) {
  const cfg = s3Config();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body !== undefined ? body : fs.createReadStream(filePath),
      ContentType: contentType,
      ...(acl ? { ACL: acl } : {}),
    })
  );

  return { Location: publicUrlFor(key), Key: key, Bucket: cfg.bucket };
}

async function deleteObject(key) {
  const cfg = s3Config();
  await getS3Client().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}

module.exports = {
  s3Config,
  getS3Client,
  resetS3Client,
  uploadObject,
  deleteObject,
  publicUrlFor,
};
