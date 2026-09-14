'use strict';

/*
 * An activity log can actually reach the cloud.
 *
 * The shop's own monitoring found this, three mails a day apart, and the number
 * that matters is the one that kept growing:
 *
 *     activitylogs till 102 vs cloud 3 (+99)
 *     activitylogs till 106 vs cloud 3 (+103)
 *     activitylogs till 108 vs cloud 3 (+105)
 *
 * The mail says "a difference is not always wrong - a till mid-upload is
 * briefly behind". A till climbing while the cloud sits frozen at three is not
 * that. It is a query that can never match.
 *
 * THE QUERY. The sync agent pushes only documents that have an `updated_date`:
 *
 *     { updated_date: { $exists: true } }
 *
 * and this schema used Mongoose `timestamps: true`, which writes `createdAt`
 * and `updatedAt` in camelCase and no `updated_date` at all. Every other synced
 * collection declares one. This was the odd one out, so not one activity log
 * had ever been pushed from any till, ever.
 *
 * These tests run the hooks rather than reading the schema, because the bug was
 * never in what the schema said - it was in what the document ended up holding.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..', '..');
const MODEL_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'models', 'activity-log.model.js'),
  'utf8'
);

/*
 * The hooks, lifted out and run against a plain object.
 *
 * Loading the model means loading mongoose, the connection layer and the
 * tenant plumbing behind it; the hooks are the whole of what changed and they
 * are ordinary functions over `this`.
 */
function hook(name) {
  const at = MODEL_SRC.indexOf(`function ${name}(`);
  expect(at).not.toBe(-1);
  const open = MODEL_SRC.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < MODEL_SRC.length; i += 1) {
    if (MODEL_SRC[i] === '{') depth += 1;
    else if (MODEL_SRC[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const body = MODEL_SRC.slice(at, i + 1);

        return new Function(`return ${body};`)();
      }
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const stampOne = hook('stampSyncDates');
const stampMany = hook('stampManySyncDates');

test('a saved log carries the field the agent looks for', () => {
  const created = new Date('2026-09-14T06:10:04.919Z');
  const doc = { createdAt: created };
  stampOne.call(doc);
  expect(doc.updated_date instanceof Date).toBe(true);
  expect(doc.updated_date.getTime()).toBe(created.getTime());
  expect(doc.created_date.getTime()).toBe(created.getTime());
});

test('the timestamp is when it happened, not when it was saved', () => {
  /*
   * An activity log is written once and never edited, so the moment it
   * happened IS the moment it last changed. Using the clock here would push a
   * row claiming it changed at whatever time the process got round to saving
   * it, which makes the cloud's ordering a lie and every checkpoint after it.
   */
  const created = new Date('2026-09-01T04:00:00.000Z');
  const doc = { createdAt: created };
  stampOne.call(doc);
  expect(doc.updated_date.getTime()).toBe(created.getTime());
  expect(MODEL_SRC).toMatch(/this\.createdAt \|\| this\.updated_date \|\| new Date\(\)/);
});

test('a log with no createdAt still gets a usable date', () => {
  /* Otherwise the one row that arrives oddly is the one that never syncs, and
     nothing says so. */
  const doc = {};
  stampOne.call(doc);
  expect(doc.updated_date instanceof Date).toBe(true);
  expect(doc.created_date instanceof Date).toBe(true);
});

test('the bulk path is stamped too, which is where a busy shop writes', () => {
  /*
   * insertMany goes straight to the driver and never runs a document hook. A
   * fix that only covered save() would leave exactly the rows a busy till
   * produces most, and the mails would have kept coming with a smaller number.
   */
  let called = false;
  const docs = [
    { createdAt: new Date('2026-09-14T01:00:00.000Z') },
    { created_date: new Date('2026-09-14T02:00:00.000Z') },
    {},
  ];
  stampMany.call(
    null,
    () => {
      called = true;
    },
    docs
  );
  expect(called).toBe(true);
  for (const doc of docs) {
    expect(doc.updated_date instanceof Date).toBe(true);
    expect(doc.created_date instanceof Date).toBe(true);
  }
  expect(docs[0].updated_date.getTime()).toBe(docs[0].createdAt.getTime());
  expect(docs[1].updated_date.getTime()).toBe(docs[1].created_date.getTime());
});

test('it survives being handed something that is not a list', () => {
  /* A hook that throws here takes every activity log write down with it, and
     an audit trail is not worth failing a sale for. */
  let called = false;
  expect(() =>
    stampMany.call(
      null,
      () => {
        called = true;
      },
      undefined
    )
  ).not.toThrow();
  expect(called).toBe(true);
});

test('the field is indexed, because the agent pages on it', () => {
  /* The push sorts by updated_date and walks it in batches. Every other synced
     collection indexes its own for the same reason. */
  expect(MODEL_SRC).toMatch(/activityLogSchema\.index\(\{ updated_date: 1 \}\)/);
});

test('the reason is written down where the next person will look', () => {
  /*
   * This cost three monitoring mails and a morning to find, and the schema
   * looks completely fine without the explanation: `timestamps: true` is the
   * normal thing to write.
   */
  expect(MODEL_SRC).toMatch(/updated_date: \{ \$exists: true \}/);
  expect(MODEL_SRC).toMatch(/timestamps: true/);
});
