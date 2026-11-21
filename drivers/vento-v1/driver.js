'use strict';

const { randomUUID } = require('crypto');
const { Driver } = require('homey');
const { VentoV1Client, discoverVentoV1 } = require('../../lib/vento-v1-client');

class VentoV1Driver extends Driver {

  async onInit() {
    this.homey.flow.getActionCard('vento_v1_speed_mode').registerRunListener(
      ({ device, speedMode }) => device.triggerCapabilityListener('speedMode', speedMode),
    );
    this.homey.flow.getActionCard('vento_v1_operation_mode').registerRunListener(
      ({ device, operationMode }) => device.triggerCapabilityListener('operationMode', operationMode),
    );
    this.homey.flow.getConditionCard('vento_v1_alarm_filter').registerRunListener(
      ({ device }) => device.getCapabilityValue('alarm_filter') === true,
    );
  }

  async onPair(session) {
    const isPaired = (ip) => this.getDevices().some((device) => device.getSetting('ip') === ip);
    const createDevice = (ip) => ({
      name: `Vento Expert V1 (${ip})`,
      data: { id: randomUUID() },
      settings: { ip },
    });
    session.setHandler('list_devices', async () => {
      const addresses = await discoverVentoV1((error) => this.error(error));
      return addresses.filter((ip) => !isPaired(ip)).map(createDevice);
    });
    session.setHandler('validate_ip', async (address) => {
      const ip = address.trim();
      if (isPaired(ip)) {
        throw new Error('A Vento Expert V1 is already paired at this address');
      }
      await new VentoV1Client(ip).readStatus();
      return createDevice(ip);
    });
  }

}

module.exports = VentoV1Driver;
