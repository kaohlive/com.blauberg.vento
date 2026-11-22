'use strict';

/**
 * UDP transport for the b133 protocol (Vento Expert, Smart Wi-Fi, HRV Wi-Fi).
 *
 * Replaces the request handling of `blaubergventojs`' BlaubergVentoClient,
 * whose socket had no 'error' listener and serialised the packet inside the
 * 'listening' callback: an unresolvable address or a bad credential became an
 * uncaught exception that crashed the app. Here every failure is a rejected
 * promise. The library's Packet is still used for (de)serialisation, so the
 * wire format is unchanged.
 *
 * Same interface as the library client for reads (`send`, `timeout`,
 * `parameterSizeResolver`), plus `write` with a per-device queue and an
 * optional confirmed write (WRITEREAD, FUNC 0x03).
 */

const dgram = require('dgram');
const net = require('net');
const { Packet, FunctionType } = require('blaubergventojs');

const PORT = 4000;
const SEARCH_DEVICE_ID = 'DEFAULT_DEVICEID';
// Special command in a response: the next byte is a parameter the controller
// does not support (b133 section "special commands").
const NOT_SUPPORTED = 0xFD;

class B133Client {

  /**
   * @param {object} [opts]
   * @param {number} [opts.timeout=1500] reply window in ms
   * @param {number} [opts.port=4000] device UDP port (tests use another)
   * @param {function} [opts.log] logger
   */
  constructor({ timeout = 1500, port = PORT, log = () => {} } = {}) {
    this.timeout = timeout;
    this.port = port;
    this.log = log;
    this.parameterSizeResolver = null;
    this._writeQueues = new Map();
    this._reportedIdMismatches = new Set();
  }

  /**
   * Send a packet and wait for the device's RESPONSE.
   *
   * @param {Packet} packet
   * @param {string} ip device IPv4 address
   * @returns {Promise<{packet: Packet, ip: string}|null>} null on timeout
   */
  send(packet, ip) {
    const invalid = this._validate(packet, ip);
    if (invalid) return Promise.reject(invalid);
    return this._exchange(packet, ip, true);
  }

  /**
   * Write to a device. Writes to one device run one at a time, in order, so a
   * slider and a flow cannot interleave their commands.
   *
   * @param {Packet} packet WRITE or WRITEREAD packet
   * @param {string} ip device IPv4 address
   * @returns {Promise<{packet: Packet, ip: string}|null>} WRITEREAD: the
   *   response, or null on timeout. WRITE: null once the packet is sent (the
   *   controller does not answer a plain write).
   */
  write(packet, ip) {
    const invalid = this._validate(packet, ip);
    if (invalid) return Promise.reject(invalid);
    const expectResponse = packet.functionType === FunctionType.WRITEREAD;
    const key = packet.deviceId;
    const previous = this._writeQueues.get(key) || Promise.resolve();
    const operation = previous.then(() => this._exchange(packet, ip, expectResponse));
    const tail = operation.catch(() => {});
    this._writeQueues.set(key, tail);
    // Drop the queue entry once idle, so removed devices do not linger.
    tail.then(() => {
      if (this._writeQueues.get(key) === tail) this._writeQueues.delete(key);
    });
    return operation;
  }

  _validate(packet, ip) {
    if (!net.isIPv4(ip)) return new Error(`Invalid device IP address '${ip}'`);
    if (typeof packet.deviceId !== 'string') return new Error(`Invalid device id '${packet.deviceId}'`);
    if (typeof packet.password !== 'string') {
      return new Error(`Device password is not set (${typeof packet.password}) for device ${packet.deviceId}`);
    }
    return null;
  }

  _exchange(packet, ip, expectResponse) {
    return new Promise((resolve, reject) => {
      let bytes;
      try {
        bytes = Buffer.from(packet.toBytes(this.parameterSizeResolver));
      } catch (error) {
        reject(error);
        return;
      }
      const socket = dgram.createSocket('udp4');
      let settled = false;
      let timer = null;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          socket.close();
        } catch (closeError) {
          // already closed
        }
        if (error) reject(error);
        else resolve(result);
      };

      socket.on('error', (error) => finish(error));
      socket.on('message', (msg, rinfo) => {
        // Only the addressed device on the protocol port may answer.
        if (rinfo.address !== ip || rinfo.port !== this.port) return;
        let reply;
        try {
          reply = Packet.fromBytes(msg, this.parameterSizeResolver);
        } catch (error) {
          reply = null;
        }
        if (!reply || reply.functionType !== FunctionType.RESPONSE) return;
        this._checkDeviceId(packet.deviceId, reply.deviceId, ip);
        finish(null, { packet: reply, ip: rinfo.address });
      });

      socket.send(bytes, 0, bytes.length, this.port, ip, (error) => {
        if (error) {
          finish(error);
        } else if (!expectResponse) {
          finish(null, null);
        }
      });
      if (expectResponse) {
        timer = setTimeout(() => finish(null, null), this.timeout);
      }
    });
  }

  // A reply carrying another id means another unit answered on this IP. Only
  // logged for now: whether every OEM unit echoes its id exactly is unverified,
  // and rejecting would cut those units off.
  _checkDeviceId(expected, actual, ip) {
    if (expected === SEARCH_DEVICE_ID || actual === expected) return;
    const key = `${expected}|${actual}`;
    if (this._reportedIdMismatches.has(key)) return;
    this._reportedIdMismatches.add(key);
    this.log(`Warning: reply from ${ip} carries device id '${actual}', expected '${expected}'`);
  }

}

/**
 * Check a WRITEREAD response for one written parameter.
 *
 * Only a missing response is an error. A different value (the controller
 * clamped it) or a "not supported" marker is logged: the device did answer,
 * and failing the user's action over it would be wrong.
 *
 * @param {{packet: Packet}|null} result response from B133Client.write
 * @param {number} param written parameter
 * @param {number} value written value
 * @param {function} log logger
 */
function checkWriteResponse(result, param, value, log) {
  const name = `0x${param.toString(16).padStart(2, '0')}`;
  if (result == null) {
    throw new Error(`Device did not confirm the change of parameter ${name}`);
  }
  const entries = result.packet.dataEntries || [];
  if (entries.some((e) => e.parameter === NOT_SUPPORTED && e.value && e.value[0] === param)) {
    log(`Device does not support writing parameter ${name}`);
    return;
  }
  const entry = entries.find((e) => e.parameter === param);
  const expected = Uint8Array.of(value)[0];
  if (!entry || !entry.value) {
    log(`Device answered the write of ${name} without reporting its value`);
  } else if (entry.value[0] !== expected) {
    log(`Device set parameter ${name} to ${entry.value[0]} instead of ${expected}`);
  }
}

module.exports = { B133Client, checkWriteResponse, PORT };
