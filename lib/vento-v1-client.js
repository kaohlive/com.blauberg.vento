'use strict';

const dgram = require('dgram');
const { isIPv4 } = require('net');
const { listInterfaces } = require('./device-discovery');

const STATUS_REQUEST = Buffer.from('6d6f62696c6501000d0a', 'hex');
const STATUS_HEADER = Buffer.from('master', 'ascii');
const SEARCH_REQUEST = Buffer.from('6d6f62696c651c000d0a', 'hex');
const STATUS_TIMEOUT = Symbol('EcoVent V1 status timeout');

function parseSearchReply(packet, remote) {
  if (remote.port !== 4000 || packet.length !== 11 || packet[6] !== 0x1c
    || !packet.subarray(0, 6).equals(STATUS_HEADER)) return null;
  const ip = packet.subarray(7).join('.');
  return ip === remote.address ? ip : null;
}

async function discoverVentoV1(log) {
  const found = new Set();
  await Promise.all(listInterfaces().map((iface) => new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let finished = false;
    let timer;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      resolve();
    };
    // eslint-disable-next-line homey-app/global-timers -- Each scan clears its own deadline.
    timer = setTimeout(finish, 1500);
    socket.on('error', (error) => {
      log(error);
      finish();
    });
    socket.on('message', (packet, remote) => {
      const ip = parseSearchReply(packet, remote);
      if (ip) found.add(ip);
    });
    socket.bind(0, iface.address, () => {
      try {
        socket.setBroadcast(true);
        for (const target of new Set([iface.broadcast, '255.255.255.255'].filter(Boolean))) {
          socket.send(SEARCH_REQUEST, 4000, target, (error) => {
            if (error) log(error);
          });
        }
      } catch (error) {
        log(error);
        finish();
      }
    });
  })));
  return [...found].sort();
}

// EcoVent V1 parameter sizes from pyEcovent's ecovent module.
const PARAMETER_SIZES = new Map([
  [0x03, 1], [0x04, 1], [0x05, 1], [0x06, 1], [0x08, 1], [0x09, 1],
  [0x0b, 1], [0x0c, 1], [0x0d, 1], [0x0e, 3], [0x0f, 3], [0x10, 3],
  [0x11, 3], [0x12, 1], [0x13, 1], [0x14, 1], [0x15, 1], [0x16, 1],
  [0x17, 1], [0x19, 1], [0x1a, 1], [0x1b, 32], [0x1c, 4], [0x1f, 1],
  [0x25, 1],
]);

function parseStatus(packet) {
  if (!packet.subarray(0, STATUS_HEADER.length).equals(STATUS_HEADER)) {
    throw new Error('Invalid EcoVent V1 status header');
  }

  const parameters = new Map();
  const status = {};
  for (let offset = STATUS_HEADER.length; offset < packet.length;) {
    const id = packet[offset++];
    if (id === 0x0d && offset === packet.length - 1 && packet[offset] === 0x0a) break;

    const size = PARAMETER_SIZES.get(id);
    if (size === undefined) {
      // An unknown field's length cannot be inferred safely.
      status.unknownParameter = { id, offset: offset - 1 };
      break;
    }
    if (offset + size > packet.length) {
      throw new Error('Truncated EcoVent V1 status parameter');
    }
    parameters.set(id, id === 0x0e ? packet.readUIntBE(offset, size) : packet[offset]);
    offset += size;
  }

  const power = parameters.get(0x03);
  if (power !== 0 && power !== 1) {
    throw new Error('EcoVent V1 status has no valid power state');
  }
  status.on = power === 1;

  const speed = parameters.get(0x04);
  if (speed >= 1 && speed <= 4) status.speed = speed; // 4 denotes manual speed.
  const manualSpeed = parameters.get(0x05);
  if (manualSpeed >= 22) status.manualSpeed = manualSpeed;
  const operationMode = parameters.get(0x06);
  if (operationMode <= 2) status.operationMode = operationMode;
  const timerMode = parameters.get(0x09);
  if (timerMode <= 2) status.timerMode = timerMode;
  const humidity = parameters.get(0x08);
  if (humidity <= 100) status.humidity = humidity;
  const alarm = parameters.get(0x0c);
  if (alarm === 0 || alarm === 1) status.alarm = alarm === 1;
  const timerRemaining = parameters.get(0x0e);
  if (timerRemaining <= 86400) status.timerRemaining = timerRemaining;
  const boost = parameters.get(0x14);
  if (boost <= 2) status.boost = boost !== 0;
  // Parameter 0x12 is the filter end-of-life indicator in the V1 feedback packet.
  const filter = parameters.get(0x12);
  if (filter !== undefined) status.filterChangeRequired = filter !== 0;
  return status;
}

class VentoV1Client {

  constructor(ip, { port = 4000, timeout = 1500, retries = 2 } = {}) {
    if (!isIPv4(ip)) throw new Error('Expected a device IPv4 address');
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Expected a UDP port between 1 and 65535');
    }
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) {
      throw new Error('Expected a positive timeout in milliseconds');
    }
    if (!Number.isSafeInteger(retries) || retries < 0) {
      throw new Error('Expected a non-negative number of retries');
    }
    this.ip = ip;
    this.port = port;
    this.timeout = timeout;
    this.retries = retries;
    this.pendingWrite = Promise.resolve();
  }

  async setPower(on) {
    if (typeof on !== 'boolean') throw new Error('Expected a boolean power state');
    return this.queueWrite(async () => {
      const current = await this.readStatus();
      if (current.status.on === on) return current;
      return this.sendAndConfirm(0x03, 0, 'on', on);
    });
  }

  async setSpeed(speed) {
    if (!Number.isInteger(speed) || speed < 1 || speed > 3) {
      throw new Error('Expected fan speed 1, 2, or 3');
    }
    return this.writeAndRead(0x04, speed, 'speed');
  }

  async setManualSpeed(speed) {
    if (!Number.isInteger(speed) || speed < 22 || speed > 255) {
      throw new Error('Expected manual fan speed between 22 and 255');
    }
    return this.queueWrite(async () => {
      const result = await this.sendAndConfirm(0x05, speed, 'manualSpeed', speed);
      if (result.status.speed !== 4) throw new Error('EcoVent V1 did not enter manual speed mode');
      return result;
    });
  }

  async setOperationMode(mode) {
    if (!Number.isInteger(mode) || mode < 0 || mode > 2) {
      throw new Error('Expected airflow mode 0, 1, or 2');
    }
    return this.writeAndRead(0x06, mode, 'operationMode');
  }

  async setTimerMode(mode) {
    if (!Number.isInteger(mode) || mode < 0 || mode > 2) {
      throw new Error('Expected timer mode 0 (regular), 1 (night), or 2 (party)');
    }
    return this.queueWrite(async () => {
      const current = await this.readStatus();
      const activeMode = current.status.timerMode;
      if (activeMode === undefined) throw new Error('EcoVent V1 did not report a timer mode');
      if (activeMode === mode) return current;

      // The active timer is toggled off to return to regular operation.
      return this.sendAndConfirm(0x09, mode === 0 ? activeMode : mode, 'timerMode', mode);
    });
  }

  writeAndRead(command, value, field) {
    return this.queueWrite(() => this.sendAndConfirm(command, value, field, value));
  }

  queueWrite(run) {
    const operation = this.pendingWrite.then(run);
    this.pendingWrite = operation.catch(() => {});
    return operation;
  }

  async sendAndConfirm(command, value, field, expected) {
    const packet = Buffer.from(STATUS_REQUEST);
    packet[6] = command;
    packet[7] = value;
    const socket = dgram.createSocket('udp4');
    try {
      await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.send(packet, this.port, this.ip, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } finally {
      socket.close();
    }

    const result = await this.readStatus();
    if (result.status[field] !== expected) {
      throw new Error(`EcoVent V1 did not confirm ${field} ${expected}`);
    }
    return result;
  }

  async readStatus() {
    // Retry only status requests. A timed-out readback may follow a successful write.
    for (let remaining = this.retries; ; remaining -= 1) {
      try {
        return await this.readStatusOnce();
      } catch (error) {
        if (error.code !== STATUS_TIMEOUT || remaining === 0) throw error;
      }
    }
  }

  readStatusOnce() {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      let settled = false;
      let timer;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        if (error) reject(error);
        else resolve(result);
      };
      // eslint-disable-next-line homey-app/global-timers -- Each request clears its own deadline.
      timer = setTimeout(() => {
        const error = new Error(`EcoVent V1 status request timed out at ${this.ip}:${this.port}`);
        error.code = STATUS_TIMEOUT;
        finish(error);
      }, this.timeout);

      socket.once('error', finish);
      socket.on('message', (packet, remote) => {
        if (remote.address !== this.ip || remote.port !== this.port) return;
        let result;
        try {
          result = { status: parseStatus(packet), raw: packet };
        } catch (error) {
          finish(error);
          return;
        }
        finish(null, result);
      });
      socket.send(STATUS_REQUEST, this.port, this.ip, (error) => {
        if (error) finish(error);
      });
    });
  }

}

module.exports = {
  VentoV1Client, discoverVentoV1, parseSearchReply, parseStatus,
};
