'use strict';

const assert = require('assert').strict;
const Module = require('module');
const { test } = require('node:test');
const { FunctionType } = require('blaubergventojs');
const { B133Client } = require('../lib/b133-transport');
const { startFakeDevice } = require('./helpers/fake-device');

// The drivers only need Homey's Driver base class for these tests.
const load = Module._load;
Module._load = function stubHomey(request, ...rest) {
  if (request === 'homey') {
    return {
      Driver: class {
        log() {}
      },
    };
  }
  return load.call(this, request, ...rest);
};

const DRIVERS = {
  'vento-expert': { reset: 0x65 },
  'smart-wifi': { reset: null },
  'hrv-wifi': { reset: 0x65 },
};
const device = (ip) => ({ id: '004C003054575303', ip });

for (const [name, { reset }] of Object.entries(DRIVERS)) {
  // eslint-disable-next-line global-require, import/no-dynamic-require -- one test block per driver
  const Driver = require(`../drivers/${name}/driver.js`);

  const withDriver = async (handler, run) => {
    const fake = await startFakeDevice(handler);
    const driver = new Driver();
    driver.modbusClient = new B133Client({ timeout: 300, port: fake.port });
    try {
      await run(driver, fake);
    } finally {
      await fake.close();
    }
  };

  test(`${name}: a write is sent as WRITEREAD and confirmed`, () => withDriver(
    (request) => [request.data[0], request.data[1]],
    async (driver, fake) => {
      await driver.setOnoffStatus(device('127.0.0.1'), '1111', 1);
      assert.equal(fake.requests[0].func, FunctionType.WRITEREAD);
    },
  ));

  test(`${name}: an unconfirmed write throws`, () => withDriver(
    () => null,
    async (driver) => {
      await assert.rejects(driver.setOnoffStatus(device('127.0.0.1'), '1111', 1), /did not confirm/);
    },
  ));

  if (reset !== null) {
    test(`${name}: the write-only filter reset is a plain WRITE`, () => withDriver(
      () => null,
      async (driver, fake) => {
        await driver.resetFilterTimer(device('127.0.0.1'), '1111');
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(fake.requests[0].func, FunctionType.WRITE);
        assert.equal(fake.requests[0].data[0], reset);
      },
    ));
  }
}
