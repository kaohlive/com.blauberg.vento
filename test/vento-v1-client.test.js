'use strict';

const assert = require('assert').strict;
const dgram = require('dgram');
const { test } = require('node:test');
const { VentoV1Client, parseSearchReply, parseStatus } = require('../lib/vento-v1-client');

const IP = '127.0.0.1';
const reply = (hex) => Buffer.concat([Buffer.from('master'), Buffer.from(hex, 'hex')]);

async function withResponder(run, onMessage) {
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, IP, resolve);
    });
    if (onMessage) {
      socket.on('message', (packet, remote) => onMessage(packet, remote, socket));
    }
    await run(socket.address().port);
  } finally {
    socket.close();
  }
}

test('parses status with optional fields and skips known multi-byte fields', () => {
  const packet = reply('03010404057b0c010e000e8b1402060208370d0a');
  assert.deepEqual(parseStatus(packet), {
    on: true,
    speed: 4,
    manualSpeed: 123,
    operationMode: 2,
    humidity: 55,
    alarm: true,
    timerRemaining: 3723,
    boost: true,
  });
  assert.deepEqual(parseStatus(reply('030006000800')), {
    on: false, operationMode: 0, humidity: 0,
  });
});

test('parses a status reply captured from a Flexit Roomie One WiFi V1', () => {
  const packet = Buffer.from('6d6173746572030109000c0013000d001a0004020500060008270e000000120014002500', 'hex');
  assert.deepEqual(parseStatus(packet), {
    on: true,
    speed: 2,
    operationMode: 0,
    timerMode: 0,
    humidity: 39,
    alarm: false,
    timerRemaining: 0,
    boost: false,
    filterChangeRequired: false,
  });
});

test('reports a filter change when the indicator is set', () => {
  assert.deepEqual(parseStatus(reply('03011201')), {
    on: true, filterChangeRequired: true,
  });
});

test('stops decoding at an undocumented field', () => {
  assert.deepEqual(parseStatus(reply('0301ff0837')), {
    on: true,
    unknownParameter: { id: 255, offset: 8 },
  });
});

test('rejects incorrect framing, missing power, and truncated fields', () => {
  assert.throws(() => parseStatus(Buffer.from('mobile')), /header/);
  assert.throws(() => parseStatus(reply('0401')), /power state/);
  assert.throws(() => parseStatus(reply('03010e0001')), /Truncated/);
});

test('sends the EcoVent read request and returns the raw status datagram', async () => {
  const packet = reply('03010401');
  let request;
  await withResponder(async (port) => {
    const client = new VentoV1Client(IP, { port });
    assert.deepEqual(await client.readStatus(), {
      status: { on: true, speed: 1 },
      raw: packet,
    });
    assert.equal(request.toString('hex'), '6d6f62696c6501000d0a');
  }, (message, remote, socket) => {
    request = message;
    socket.send(packet, remote.port, remote.address);
  });
});

test('retries a lost status request and returns the reply', async () => {
  let attempts = 0;
  await withResponder(async (port) => {
    const client = new VentoV1Client(IP, { port, timeout: 100 });
    assert.deepEqual((await client.readStatus()).status, { on: false });
    assert.equal(attempts, 2);
  }, (message, remote, socket) => {
    attempts += 1;
    if (attempts === 2) socket.send(reply('0300'), remote.port, remote.address);
  });
});

test('stops after the initial request and two retries', async () => {
  let attempts = 0;
  await withResponder(async (port) => {
    const client = new VentoV1Client(IP, { port, timeout: 50 });
    await assert.rejects(client.readStatus(), /timed out/);
    assert.equal(attempts, 3);
  }, () => {
    attempts += 1;
  });
});

test('rejects invalid endpoint and timeout settings', () => {
  assert.throws(() => new VentoV1Client('localhost'), /IPv4/);
  assert.throws(() => new VentoV1Client(IP, { port: 65536 }), /port/);
  assert.throws(() => new VentoV1Client(IP, { timeout: 0 }), /timeout/);
  assert.throws(() => new VentoV1Client(IP, { retries: -1 }), /retries/);
});

test('sends speed and airflow commands and verifies both with a status read', async () => {
  const requests = [];
  let status = reply('030104020600');
  await withResponder(async (port) => {
    const client = new VentoV1Client(IP, { port });
    const [speed, mode] = await Promise.all([client.setSpeed(3), client.setOperationMode(1)]);
    assert.equal(speed.status.speed, 3);
    assert.equal(mode.status.operationMode, 1);
    assert.deepEqual(requests, ['0403', '0100', '0601', '0100']);
  }, (message, remote, socket) => {
    assert.equal(message.subarray(0, 6).toString(), 'mobile');
    assert.equal(message.subarray(8).toString('hex'), '0d0a');
    const command = message.subarray(6, 8).toString('hex');
    requests.push(command);
    if (command === '0403') status = reply('030104030600');
    if (command === '0601') status = reply('030104030601');
    if (command === '0100') socket.send(status, remote.port, remote.address);
  });
});

test('rejects an unconfirmed write and checks control arguments', async () => {
  await withResponder(async (port) => {
    const client = new VentoV1Client(IP, { port });
    await assert.rejects(client.setSpeed(4), /Expected fan speed/);
    await assert.rejects(client.setOperationMode(3), /Expected airflow mode/);
    await assert.rejects(client.setSpeed(3), /did not confirm speed 3/);
    assert.equal((await client.setOperationMode(0)).status.operationMode, 0);
  }, (message, remote, socket) => {
    if (message[6] === 0x01) socket.send(reply('030104020600'), remote.port, remote.address);
  });
});

test('sets night and party timers and toggles the active timer off for regular mode', async () => {
  let mode = 0;
  const commands = [];
  await withResponder(async (port) => {
    const client = new VentoV1Client(IP, { port });
    const results = await Promise.all([1, 1, 2, 0, 0].map((value) => client.setTimerMode(value)));
    assert.deepEqual(results.map(({ status }) => status.timerMode), [1, 1, 2, 0, 0]);
    assert.deepEqual(commands, ['0901', '0902', '0902']);
  }, (message, remote, socket) => {
    if (message[6] === 0x01) {
      socket.send(reply(`0301090${mode}`), remote.port, remote.address);
    } else {
      commands.push(message.subarray(6, 8).toString('hex'));
      mode = mode === message[7] ? 0 : message[7];
    }
  });
});

test('uses a fresh power read and toggles only when the requested state differs', async () => {
  let on = true;
  let toggles = 0;
  let dropReadback = false;
  await withResponder(async (port) => {
    const client = new VentoV1Client(IP, { port, timeout: 100 });
    const results = await Promise.all([true, false, false, true].map((value) => client.setPower(value)));
    assert.deepEqual(results.map(({ status }) => status.on), [true, false, false, true]);
    assert.equal(toggles, 2);
  }, (message, remote, socket) => {
    if (message[6] === 0x03) {
      assert.equal(message[7], 0);
      toggles += 1;
      on = !on;
      dropReadback = true;
    } else if (dropReadback) {
      dropReadback = false;
    } else {
      socket.send(reply(on ? '0301' : '0300'), remote.port, remote.address);
    }
  });
});

test('sets manual speed and requires the fan to enter manual mode', async () => {
  let manualMode = false;
  const speeds = [];
  await withResponder(async (port) => {
    const client = new VentoV1Client(IP, { port });
    await assert.rejects(client.setManualSpeed(21), /between 22 and 255/);
    await assert.rejects(client.setManualSpeed(128), /did not enter manual speed mode/);
    manualMode = true;
    const { status } = await client.setManualSpeed(128);
    assert.equal(status.speed, 4);
    assert.equal(status.manualSpeed, 128);
    assert.deepEqual(speeds, [128, 128]);
  }, (message, remote, socket) => {
    if (message[6] === 0x05) {
      speeds.push(message[7]);
    } else {
      socket.send(reply(manualMode ? '030104040580' : '030104020580'), remote.port, remote.address);
    }
  });
});

test('recognises the captured Flexit discovery reply and validates its source', () => {
  const packet = Buffer.from('6d61737465721cc0a85802', 'hex');
  const remote = { address: '192.168.88.2', port: 4000 };
  assert.equal(parseSearchReply(packet, remote), remote.address);
  assert.equal(parseSearchReply(packet, { ...remote, address: '192.168.88.3' }), null);
  assert.equal(parseSearchReply(packet, { ...remote, port: 4001 }), null);
  assert.equal(parseSearchReply(reply('0301'), remote), null);
});
