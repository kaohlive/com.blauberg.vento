'use strict';

const { scanByIP } = require('./device-discovery');
const { getValidLastKnownIp } = require('./ip-address');

// Wait between unicast probes of one unavailable device; the last value is
// repeated. A device that is really gone costs one small packet per 10 min.
const PROBE_DELAYS_MS = [60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];

/**
 * Try to reach an unavailable device by unicast on its last known IP.
 *
 * Normally only the broadcast discovery can bring an unavailable device back,
 * and the unicast attempt on the last known IP is made once, at init. When
 * broadcast replies do not arrive (network filtering, Homey firmware) but
 * unicast works, a device would then stay unavailable until the app restarts.
 *
 * Uses a unicast SEARCH, which needs no password and returns the replying
 * device's id: a different Blauberg unit that took over the old IP via DHCP
 * is not adopted. On a match the device is registered with the driver and
 * the normal discovery() path makes it available.
 *
 * Call only for devices that were not located by this discovery round.
 *
 * @param {import('homey').Driver} driver driver owning deviceList
 * @param {import('homey').Device} device unavailable Homey device
 */
async function probeUnavailableDevice(driver, device) {
  const now = Date.now();
  const probe = device._ipProbe || (device._ipProbe = { busy: false, attempts: 0, nextAt: 0 });
  if (probe.busy || now < probe.nextAt) return;
  probe.busy = true;
  // Schedule the next attempt up front, so an error also respects the wait.
  probe.nextAt = now + PROBE_DELAYS_MS[Math.min(probe.attempts, PROBE_DELAYS_MS.length - 1)];
  probe.attempts += 1;
  try {
    const { id } = device.getData();
    const ip = await getValidLastKnownIp(device);
    if (!ip || ip === '0.0.0.0') return;

    const result = await scanByIP(ip, {
      timeout: 2000,
      sizeResolver: driver.modbusClient.parameterSizeResolver,
    });
    if (result && result.id === id) {
      device.log(`Unicast probe: device answered at last known IP ${ip}, reconnecting`);
      if (!driver.locateDeviceById(id)) driver.deviceList.push({ id, ip: result.ip });
      probe.attempts = 0;
      probe.nextAt = 0;
      await device.discovery(id);
      return;
    }
    if (result && result.id) {
      device.log(`Unicast probe: ${ip} is now another device (${result.id}), not reconnecting`);
    }
  } catch (error) {
    device.log(`Unicast probe failed: ${error.message}`);
  } finally {
    probe.busy = false;
  }
}

module.exports = { probeUnavailableDevice };
