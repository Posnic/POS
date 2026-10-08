"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { portIsFree } = require("../src/local-ports");

test("API availability probe refuses a port held by a wildcard listener", async () => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, resolve);
  });
  const port = listener.address().port;
  try {
    assert.equal(await portIsFree(port), false);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
  assert.equal(await portIsFree(port), true);
});

test("database availability probe also refuses an IPv4 loopback listener", async () => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  try {
    assert.equal(await portIsFree(listener.address().port), false);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});

test("an explicit data profile cannot attach to another profiles database", async () => {
  const Manager = require("../src/mongodb-manager");
  const manager = new Manager();
  manager.checkBundledMongoExists = () => true;
  manager.isPortOpen = async () => true;
  manager._ownsRunningMongo = () => false;
  const previous = process.env.POSNIC_USER_DATA;
  process.env.POSNIC_USER_DATA = "test-isolation";
  try {
    await assert.rejects(manager.start(), { code: "MONGODB_PROFILE_MISMATCH" });
    assert.equal(manager.isRunning, false);
    assert.equal(manager.usingExternal, false);
  } finally {
    if (previous === undefined) delete process.env.POSNIC_USER_DATA;
    else process.env.POSNIC_USER_DATA = previous;
  }
});
