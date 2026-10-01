"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dailyReportPeriod } = require("../api/src/helpers/daily-report-period");
const q = {
  starting_date: "2026/10/01 12:00 AM",
  ending_date: "2026/10/01 11:59 PM",
};
const matches = (p, iso, since) =>
  p
    .match("date", since)
    .$or.some(
      (x) => new Date(iso) >= x.date.$gte && new Date(iso) < x.date.$lt,
    );
test("full day uses shop midnight rather than server midnight", () => {
  const p = dailyReportPeriod(q, "Asia/Kolkata");
  assert.equal(p.start.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(p.end.toISOString(), "2026-10-01T18:30:00.000Z");
});
test("meal boundaries never double count noon", () => {
  const breakfast = dailyReportPeriod(
    { ...q, start_time: "06:00", end_time: "12:00" },
    "Asia/Kolkata",
  );
  const lunch = dailyReportPeriod(
    { ...q, start_time: "12:00", end_time: "18:00" },
    "Asia/Kolkata",
  );
  assert.equal(matches(breakfast, "2026-10-01T06:30:00Z"), false);
  assert.equal(matches(lunch, "2026-10-01T06:30:00Z"), true);
  assert.equal(matches(breakfast, "2026-10-01T06:29:59.999Z"), true);
});
test("multi-day range selects each meal, excluding the gap", () => {
  const p = dailyReportPeriod(
    { ...q, ending_date: "2026-10-02", start_time: "06:00", end_time: "12:00" },
    "Asia/Kolkata",
  );
  assert.equal(matches(p, "2026-10-01T13:00:00Z"), false);
  assert.equal(matches(p, "2026-10-02T01:00:00Z"), true);
});
test("overnight session belongs to the selected start date", () => {
  const p = dailyReportPeriod(
    { ...q, start_time: "22:00", end_time: "02:00" },
    "Asia/Kolkata",
  );
  assert.equal(matches(p, "2026-10-01T19:00:00Z"), true);
  assert.equal(matches(p, "2026-10-01T20:30:00Z"), false);
  assert.equal(matches(p, "2026-09-30T19:00:00Z"), false);
});
test("session permission cannot be widened back to midnight", () => {
  const p = dailyReportPeriod(
    { ...q, start_time: "06:00", end_time: "12:00" },
    "Asia/Kolkata",
  );
  assert.equal(
    matches(p, "2026-10-01T01:00:00Z", new Date("2026-10-01T03:00:00Z")),
    false,
  );
});
test("full-day DST window follows local day length", () => {
  const p = dailyReportPeriod(
    { starting_date: "2026-03-08", ending_date: "2026-03-08" },
    "America/New_York",
  );
  assert.equal((p.end - p.start) / 3600000, 23);
});
test("reject incomplete, equal, invalid times and reversed dates", () => {
  for (const extra of [
    { start_time: "12:00" },
    { start_time: "24:00", end_time: "03:00" },
    { start_time: "06:00", end_time: "06:00" },
    { ending_date: "2026-09-30" },
  ])
    assert.throws(
      () => dailyReportPeriod({ ...q, ...extra }, "Asia/Kolkata"),
      (e) => e.statusCode === 400,
    );
});

test("saved meal hours support weekday schedules, gaps, and overnight windows", () => {
  const saved = [
    {
      id: "dinner",
      name: "Late dinner",
      hours: {
        thu: [{ open: 1200, close: 60 }],
        fri: [
          { open: 1080, close: 1200 },
          { open: 1260, close: 1380 },
        ],
      },
    },
  ];
  const p = dailyReportPeriod(
    { ...q, ending_date: "2026-10-02", serving_period: "dinner" },
    "Asia/Kolkata",
    saved,
  );
  assert.equal(matches(p, "2026-10-01T18:45:00Z"), true);
  assert.equal(matches(p, "2026-10-02T15:00:00Z"), false);
  assert.equal(matches(p, "2026-10-02T16:00:00Z"), true);
  assert.match(p.label, /Late dinner/);
});
test("closed session days match nothing and missing configured times are rejected", () => {
  const p = dailyReportPeriod(
    { ...q, serving_period: "breakfast" },
    "Asia/Kolkata",
    [
      {
        id: "breakfast",
        name: "Breakfast",
        hours: { mon: [{ open: 420, close: 660 }] },
      },
    ],
  );
  assert.equal(matches(p, "2026-10-01T03:00:00Z"), false);
  assert.throws(
    () =>
      dailyReportPeriod(
        { ...q, serving_period: "missing" },
        "Asia/Kolkata",
        [],
      ),
    (e) => e.statusCode === 400,
  );
});
