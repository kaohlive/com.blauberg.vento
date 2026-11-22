'use strict';

const assert = require('assert').strict;
const path = require('path');
const { test } = require('node:test');

// Replace the unicast scan before the probe module loads it.
let reply = null;
let scans = 0;
const discoveryPath = require.resolve(path.join(__dirname, '../lib/device-discovery'));
require.cache[discoveryPath] = {
  id: discoveryPath,
  filename: discoveryPath,
  loaded: true,
  exports: {
    scanByIP: async (ip) => {
      scans += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return reply && { ...reply, ip };
    },
  },
};
const { probeUnavailableDevice } = require('../lib/unavailable-probe');

function createFixture() {
  reply = null;
  scans = 0;
  const driver = {
    deviceList: [],
    modbusClient: {},
    locateDeviceById(id) {
      return this.deviceList.find((d) => d.id === id);
    },
  };
  const device = {
    store: { lastKnownIP: '192.168.0.123' },
    discovered: 0,
    logs: [],
    getData: () => ({ id: 'A' }),
    getStoreValue(key) {
      return this.store[key];
    },
    setStoreValue: async () => undefined,
    setSettings: async () => undefined,
    log(message) {
      this.logs.push(message);
    },
    async discovery(id) {
      this.discovered += 1;
      this.deviceObject = driver.locateDeviceById(id);
    },
  };
  return { driver, device };
}

test('reconnects when the device itself answers on its last IP', async () => {
  const { driver, device } = createFixture();
  reply = { id: 'A' };
  await probeUnavailableDevice(driver, device);
  assert.equal(device.discovered, 1);
  assert.equal(device.deviceObject.ip, '192.168.0.123');
});

test('does not adopt another unit that took over the IP', async () => {
  const { driver, device } = createFixture();
  reply = { id: 'B' };
  await probeUnavailableDevice(driver, device);
  assert.equal(device.discovered, 0);
  assert.equal(driver.deviceList.length, 0);
  assert.match(device.logs[0], /now another device \(B\)/);
});

test('backs off between attempts when there is no reply', async () => {
  const { driver, device } = createFixture();
  await probeUnavailableDevice(driver, device);
  await probeUnavailableDevice(driver, device);
  assert.equal(scans, 1);
  const wait = () => Math.round((device._ipProbe.nextAt - Date.now()) / 1000);
  assert.equal(wait(), 60);
  device._ipProbe.nextAt = 0;
  await probeUnavailableDevice(driver, device);
  assert.equal(wait(), 120);
});

test('runs one probe per device at a time', async () => {
  const { driver, device } = createFixture();
  await Promise.all([probeUnavailableDevice(driver, device), probeUnavailableDevice(driver, device)]);
  assert.equal(scans, 1);
});
