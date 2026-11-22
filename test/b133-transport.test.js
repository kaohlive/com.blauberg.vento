'use strict';

const assert = require('assert').strict;
const dgram = require('dgram');
const { test } = require('node:test');
const {
  Packet, FunctionType, DataEntry, Parameter,
} = require('blaubergventojs');
const { B133Client, checkWriteResponse } = require('../lib/b133-transport');
const { startFakeDevice, encodePacket } = require('./helpers/fake-device');

const ID = '004C003054575303';
const IP = '127.0.0.1';

const readPacket = (password = '1111') => new Packet(ID, password, FunctionType.READ, [
  DataEntry.of(Parameter.ON_OFF), DataEntry.of(Parameter.SPEED),
]);
const writePacket = (func, param, value) => new Packet(ID, '1111', func, [DataEntry.of(param, value)]);
const client = (port, opts = {}) => {
  const c = new B133Client({ timeout: 300, port, ...opts });
  c.parameterSizeResolver = Parameter.getSize;
  return c;
};

test('read returns the parsed response', async () => {
  const device = await startFakeDevice(() => [0x01, 0x01, 0x02, 0x03]);
  try {
    const result = await client(device.port).send(readPacket(), IP);
    assert.equal(result.ip, IP);
    assert.deepEqual(result.packet.dataEntries.map((e) => [e.parameter, e.value[0]]), [[0x01, 1], [0x02, 3]]);
  } finally {
    await device.close();
  }
});

test('read resolves null when the device stays silent', async () => {
  const device = await startFakeDevice(() => null);
  try {
    assert.equal(await client(device.port).send(readPacket(), IP), null);
  } finally {
    await device.close();
  }
});

test('invalid address and missing password reject instead of crashing', async () => {
  const c = client(4000);
  await assert.rejects(c.send(readPacket(), '192.168.68.68:4000'), /Invalid device IP address/);
  const noPassword = new Packet(ID, undefined, FunctionType.READ, [DataEntry.of(Parameter.ON_OFF)]);
  await assert.rejects(c.send(noPassword, IP), /password is not set/);
  await assert.rejects(c.write(noPassword, IP), /password is not set/);
});

test('ignores a reply that does not come from the device port', async () => {
  const other = dgram.createSocket('udp4');
  await new Promise((resolve) => other.bind(0, IP, resolve));
  const device = await startFakeDevice((request, rinfo) => {
    other.send(encodePacket(request.id, request.password, 0x06, [0x01, 0x01]), rinfo.port, IP);
    return null;
  });
  try {
    assert.equal(await client(device.port).send(readPacket(), IP), null);
    assert.equal(device.requests.length, 1);
  } finally {
    other.close();
    await device.close();
  }
});

test('plain WRITE resolves once sent, without waiting for a reply', async () => {
  const device = await startFakeDevice(() => null);
  try {
    const started = Date.now();
    const result = await client(device.port, { timeout: 2000 })
      .write(writePacket(FunctionType.WRITE, Parameter.RESET_FILTER_TIMER, 1), IP);
    assert.equal(result, null);
    assert.ok(Date.now() - started < 1000);
  } finally {
    await device.close();
  }
});

test('WRITEREAD response confirms the written value', async () => {
  const device = await startFakeDevice((request) => {
    assert.equal(request.func, FunctionType.WRITEREAD);
    return [0x02, 0x03];
  });
  try {
    const logs = [];
    const result = await client(device.port).write(writePacket(FunctionType.WRITEREAD, Parameter.SPEED, 3), IP);
    checkWriteResponse(result, Parameter.SPEED, 3, (m) => logs.push(m));
    assert.deepEqual(logs, []);
  } finally {
    await device.close();
  }
});

test('a clamped value or unsupported parameter is logged, not thrown', async () => {
  const logs = [];
  const clamped = { packet: { dataEntries: [{ parameter: 0x19, value: Uint8Array.of(80) }] } };
  checkWriteResponse(clamped, 0x19, 90, (m) => logs.push(m));
  const unsupported = { packet: { dataEntries: [{ parameter: 0xFD, value: Uint8Array.of(0x19) }] } };
  checkWriteResponse(unsupported, 0x19, 50, (m) => logs.push(m));
  assert.equal(logs.length, 2);
  assert.match(logs[0], /to 80 instead of 90/);
  assert.match(logs[1], /does not support writing parameter 0x19/);
});

test('a missing WRITEREAD confirmation throws', () => {
  assert.throws(() => checkWriteResponse(null, 0x02, 3, () => {}), /did not confirm/);
});

test('writes to one device run in order', async () => {
  const order = [];
  const device = await startFakeDevice(async (request) => {
    const value = request.data[1];
    // The first write answers slowest; it must still finish first.
    await new Promise((resolve) => setTimeout(resolve, value === 1 ? 100 : 0));
    order.push(value);
    return [0x02, value];
  });
  try {
    const c = client(device.port);
    const resolved = [];
    await Promise.all([1, 2, 3].map((v) => c
      .write(writePacket(FunctionType.WRITEREAD, Parameter.SPEED, v), IP)
      .then(() => resolved.push(v))));
    assert.deepEqual(order, [1, 2, 3]);
    assert.deepEqual(resolved, [1, 2, 3]);
  } finally {
    await device.close();
  }
});

test('a reply with another device id is accepted but logged once', async () => {
  const device = await startFakeDevice((request) => {
    request.replyId = 'FFFFFFFFFFFFFFFF';
    return [0x01, 0x01];
  });
  try {
    const logs = [];
    const c = client(device.port, { log: (m) => logs.push(m) });
    assert.notEqual(await c.send(readPacket(), IP), null);
    assert.notEqual(await c.send(readPacket(), IP), null);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /carries device id 'FFFFFFFFFFFFFFFF'/);
  } finally {
    await device.close();
  }
});
