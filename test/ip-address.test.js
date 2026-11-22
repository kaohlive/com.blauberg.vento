'use strict';

const assert = require('assert').strict;
const { test } = require('node:test');
const { normalizeIp, getValidLastKnownIp, applyLastKnownIpSetting } = require('../lib/ip-address');

function fakeDevice(store = {}) {
  return {
    store,
    settings: {},
    logs: [],
    getStoreValue(key) {
      return this.store[key];
    },
    async setStoreValue(key, value) {
      this.store[key] = value;
    },
    async setSettings(values) {
      Object.assign(this.settings, values);
    },
    log(message) {
      this.logs.push(message);
    },
    homey: { setTimeout: (fn) => fn() },
  };
}

test('normalizeIp strips the protocol port and rejects anything else', () => {
  assert.equal(normalizeIp('192.168.68.68:4000'), '192.168.68.68');
  assert.equal(normalizeIp(' 10.0.0.5 '), '10.0.0.5');
  assert.equal(normalizeIp('192.168.68.68:5000'), null);
  assert.equal(normalizeIp('fan.local'), null);
  assert.equal(normalizeIp(undefined), null);
});

test('a stored address with port is repaired at init', async () => {
  const device = fakeDevice({ lastKnownIP: '192.168.68.68:4000' });
  assert.equal(await getValidLastKnownIp(device), '192.168.68.68');
  assert.equal(device.store.lastKnownIP, '192.168.68.68');
  assert.equal(device.settings.last_known_ip, '192.168.68.68');
});

test('an unusable stored address is ignored', async () => {
  const device = fakeDevice({ lastKnownIP: 'garbage' });
  assert.equal(await getValidLastKnownIp(device), null);
  assert.equal(device.store.lastKnownIP, 'garbage');
});

test('the IP setting rejects invalid input and normalises the rest', async () => {
  const device = fakeDevice();
  await assert.rejects(applyLastKnownIpSetting(device, 'fan.local'), /not a valid IP address/);
  await applyLastKnownIpSetting(device, '10.0.1.171:4000');
  assert.equal(device.store.lastKnownIP, '10.0.1.171');
  assert.equal(device.settings.last_known_ip, '10.0.1.171');
  await applyLastKnownIpSetting(device, '');
  assert.equal(device.store.lastKnownIP, '');
});
