'use strict';

/**
 * Robust device discovery for Blauberg / OEM units speaking the b133 UDP
 * protocol on port 4000.
 *
 * The `blaubergventojs` library only sends a single SEARCH broadcast to
 * 255.255.255.255, which egresses just the OS default-route interface. On a
 * Homey Pro with both Ethernet and Wi-Fi (or multiple VLANs) a unit on the
 * "other" interface never receives it. This module instead:
 *
 *  - enumerates every non-internal IPv4 interface and sends a directed
 *    broadcast (addr | ~netmask) bound to each interface, plus the global
 *    255.255.255.255 as a fallback;
 *  - supports a targeted unicast scan of a single IP (manual pairing /
 *    diagnostics);
 *  - logs the network interfaces and the raw bytes of any response, so a
 *    non-responding or oddly-formatted device can be diagnosed from logs.
 *
 * Reuses the library's Packet (de)serialization so the wire format stays
 * identical to the rest of the app.
 */

const dgram = require('dgram');
const os = require('os');
const {
  Packet, FunctionType, DataEntry, Parameter,
} = require('blaubergventojs');

const PORT = 4000;
const SEARCH_DEVICE_ID = 'DEFAULT_DEVICEID';

/**
 * Build the SEARCH discovery packet (DEFAULT_DEVICEID, empty password).
 * @returns {Uint8Array}
 */
function buildSearchPacket() {
  const packet = new Packet(SEARCH_DEVICE_ID, '', FunctionType.READ, [
    DataEntry.of(Parameter.SEARCH),
  ]);
  return packet.toBytes();
}

/**
 * Convert a UDP message buffer to a hex string for diagnostic logging.
 * @param {Buffer} msg
 * @returns {string}
 */
function toHex(msg) {
  return Buffer.from(msg).toString('hex').replace(/(..)/g, '$1 ').trim();
}

/**
 * Compute the directed broadcast address for an interface (addr | ~netmask).
 * @param {string} address dotted IPv4
 * @param {string} netmask dotted IPv4
 * @returns {string|null}
 */
function directedBroadcast(address, netmask) {
  try {
    const a = address.split('.').map(Number);
    const m = netmask.split('.').map(Number);
    if (a.length !== 4 || m.length !== 4) return null;
    return a.map((part, i) => (part & m[i]) | (~m[i] & 0xff)).join('.');
  } catch (err) {
    return null;
  }
}

/**
 * List the non-internal IPv4 interfaces Homey could discover on.
 * @returns {Array<{name:string,address:string,netmask:string,broadcast:string}>}
 */
function listInterfaces() {
  const nets = os.networkInterfaces();
  const result = [];
  Object.keys(nets).forEach((name) => {
    nets[name].forEach((net) => {
      const isV4 = net.family === 'IPv4' || net.family === 4;
      if (isV4 && !net.internal) {
        result.push({
          name,
          address: net.address,
          netmask: net.netmask,
          broadcast: directedBroadcast(net.address, net.netmask),
        });
      }
    });
  });
  return result;
}

/**
 * Parse a UDP message into a discovered device, or null if it is not a valid
 * RESPONSE packet for our protocol.
 * @param {Buffer} msg
 * @param {object} rinfo
 * @param {function} sizeResolver
 * @returns {{id:string, ip:string}|null}
 */
function parseResponse(msg, rinfo, sizeResolver) {
  try {
    const packet = Packet.fromBytes(msg, sizeResolver);
    if (packet && packet.functionType === FunctionType.RESPONSE) {
      return { id: packet.deviceId, ip: rinfo.address };
    }
  } catch (err) {
    // fall through - caller logs raw bytes
  }
  return null;
}

/**
 * Discover devices across every local IPv4 interface using directed + global
 * broadcasts. Aggregates unique devices by id.
 *
 * @param {object} opts
 * @param {number} [opts.timeout=1500] listen window in ms
 * @param {function} [opts.sizeResolver] parameter size resolver for parsing
 * @param {function} [opts.log] logger (e.g. driver.log.bind(driver))
 * @returns {Promise<Array<{id:string, ip:string}>>}
 */
function discoverDevices({ timeout = 1500, sizeResolver = null, log = () => {} } = {}) {
  const interfaces = listInterfaces();
  log(`Discovery: ${interfaces.length} local IPv4 interface(s): ${interfaces
    .map((i) => `${i.name} ${i.address}/${i.netmask} -> bc ${i.broadcast}`)
    .join('; ')}`);

  if (interfaces.length === 0) {
    log('Discovery: no usable network interfaces found');
    return Promise.resolve([]);
  }

  const payload = Buffer.from(buildSearchPacket());
  const found = new Map();

  const scanOnInterface = (iface) => new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch (err) {
        // socket already closed
      }
      resolve();
    };

    socket.on('error', (err) => {
      log(`Discovery: socket error on ${iface.name} (${iface.address}): ${err.message}`);
      finish();
    });

    socket.on('message', (msg, rinfo) => {
      const device = parseResponse(msg, rinfo, sizeResolver);
      if (device) {
        if (!found.has(device.id)) {
          log(`Discovery: located device ${device.id} at ${device.ip} via ${iface.name}`);
        }
        found.set(device.id, device);
      } else {
        log(`Discovery: unparseable reply from ${rinfo.address}:${rinfo.port} (${msg.length} bytes): ${toHex(msg)}`);
      }
    });

    socket.on('listening', () => {
      try {
        socket.setBroadcast(true);
        const targets = [iface.broadcast, '255.255.255.255'].filter(Boolean);
        targets.forEach((target) => {
          socket.send(payload, 0, payload.length, PORT, target, (err) => {
            if (err) log(`Discovery: send to ${target} via ${iface.name} failed: ${err.message}`);
          });
        });
      } catch (err) {
        log(`Discovery: setup error on ${iface.name}: ${err.message}`);
        finish();
      }
    });

    setTimeout(finish, timeout);

    try {
      socket.bind({ address: iface.address, port: 0, exclusive: false });
    } catch (err) {
      log(`Discovery: bind error on ${iface.address}: ${err.message}`);
      finish();
    }
  });

  return Promise.all(interfaces.map(scanOnInterface)).then(() => {
    const devices = Array.from(found.values());
    log(`Discovery: total unique devices located: ${devices.length}`);
    return devices;
  });
}

/**
 * Unicast SEARCH against a single IP - used for manual pairing and as a
 * diagnostic for units that do not answer broadcasts. Always logs the raw
 * reply (or lack thereof) so an unexpected protocol/format is visible.
 *
 * @param {string} ip target IPv4 address
 * @param {object} opts
 * @param {number} [opts.timeout=2000]
 * @param {function} [opts.sizeResolver]
 * @param {function} [opts.log]
 * @returns {Promise<{id:string, ip:string, rawHex:string}|null>}
 */
function scanByIP(ip, { timeout = 2000, sizeResolver = null, log = () => {} } = {}) {
  return new Promise((resolve) => {
    const payload = Buffer.from(buildSearchPacket());
    const socket = dgram.createSocket('udp4');
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      try {
        socket.close();
      } catch (err) {
        // socket already closed
      }
      resolve(result);
    };

    socket.on('error', (err) => {
      log(`scanByIP ${ip}: socket error: ${err.message}`);
      finish(null);
    });

    socket.on('message', (msg, rinfo) => {
      const rawHex = toHex(msg);
      log(`scanByIP ${ip}: reply from ${rinfo.address}:${rinfo.port} (${msg.length} bytes): ${rawHex}`);
      const device = parseResponse(msg, rinfo, sizeResolver);
      if (device) {
        finish({ id: device.id, ip: rinfo.address, rawHex });
      } else {
        log(`scanByIP ${ip}: reply could not be parsed as a b133 RESPONSE packet`);
        finish({ id: null, ip: rinfo.address, rawHex });
      }
    });

    socket.on('listening', () => {
      socket.send(payload, 0, payload.length, PORT, ip, (err) => {
        if (err) {
          log(`scanByIP ${ip}: send failed: ${err.message}`);
          finish(null);
        }
      });
    });

    setTimeout(() => {
      log(`scanByIP ${ip}: no reply within ${timeout}ms (device may use a different protocol/port, or be unreachable)`);
      finish(null);
    }, timeout);

    socket.bind();
  });
}

module.exports = {
  discoverDevices,
  scanByIP,
  listInterfaces,
  directedBroadcast,
};
