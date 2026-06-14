'use strict';

const { Driver } = require('homey');
const {
  BlaubergVentoClient, Packet, FunctionType, DataEntry,
} = require('blaubergventojs');
const { BreezyParameter, BreezyParameterSizes, BreezyDeviceTypes } = require('../../lib/breezy-parameters');
const { discoverDevices, scanByIP } = require('../../lib/device-discovery');

class HrvWifiDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.deviceList = [];
    this.modbusClient = new BlaubergVentoClient();
    this.modbusClient.timeout = 1500;
    this.modbusClient.parameterSizeResolver = (param) => {
      const size = BreezyParameterSizes[param];
      return size !== undefined ? size : -1;
    };
    this.log('HRV Wi-Fi driver has been initialized');
    setTimeout(() => {
      this.locateDevices();
      this.start_discover_loop();
    }, 5000);
  }

  // eslint-disable-next-line camelcase
  start_discover_loop() {
    this._timer = this.homey.setInterval(async () => {
      await this.locateDevices();
    }, 10000);
  }

  async setDeviceValue(device, devicepass, param, value) {
    const packet = new Packet(device.id, devicepass, FunctionType.WRITE, [
      DataEntry.of(param, value),
    ]);
    return this.modbusClient.send(packet, device.ip).then((result) => {
      if (result == null) {
        this.log(`Warning: no response for write param=${param} value=${value}`);
      }
    }).catch((error) => {
      this.log(`Error writing param=${param}: ${error.message}`);
    });
  }

  async setOnoffStatus(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, BreezyParameter.ON_OFF, value);
  }

  async setSpeedMode(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, BreezyParameter.SPEED, value);
  }

  async setOperationMode(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, BreezyParameter.VENTILATION_MODE, value);
  }

  async setTimerMode(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, BreezyParameter.TIMER_MODE, value);
  }

  async setManualSpeed(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, BreezyParameter.MANUAL_SPEED, value);
  }

  async setHumiditySensor(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, BreezyParameter.HUMIDITY_SENSOR_ENABLE, value);
  }

  async setHumidityThreshold(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, BreezyParameter.HUMIDITY_THRESHOLD, value);
  }

  async setCo2Sensor(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, BreezyParameter.CO2_SENSOR_ENABLE, value);
  }

  async resetFilterTimer(device, devicepass) {
    return this.setDeviceValue(device, devicepass, BreezyParameter.FILTER_RESET, 1);
  }

  async getDeviceState(device, devicepass) {
    const packet = new Packet(device.id, devicepass, FunctionType.READ, [
      DataEntry.of(BreezyParameter.ON_OFF),
      DataEntry.of(BreezyParameter.SPEED),
      DataEntry.of(BreezyParameter.MANUAL_SPEED),
      DataEntry.of(BreezyParameter.TIMER_MODE),
      DataEntry.of(BreezyParameter.TIMER_COUNTDOWN),
      DataEntry.of(BreezyParameter.VENTILATION_MODE),
      DataEntry.of(BreezyParameter.CURRENT_HUMIDITY),
      DataEntry.of(BreezyParameter.FAN1_RPM),
      DataEntry.of(BreezyParameter.FAN2_RPM),
      DataEntry.of(BreezyParameter.FILTER_STATUS),
      DataEntry.of(BreezyParameter.FILTER_TIMER_COUNTDOWN),
      DataEntry.of(BreezyParameter.ALARM_INDICATOR),
      DataEntry.of(BreezyParameter.UNIT_TYPE),
      DataEntry.of(BreezyParameter.HUMIDITY_SENSOR_ENABLE),
      DataEntry.of(BreezyParameter.HUMIDITY_THRESHOLD),
      DataEntry.of(BreezyParameter.CO2_SENSOR_ENABLE),
    ]);

    return this.modbusClient.send(packet, device.ip).then((result) => {
      if (result != null) {
        const entries = result.packet._dataEntries;
        if (entries.length < 16) {
          this.log(`Warning: expected 16 data entries, got ${entries.length}`);
          throw new Error(`Incomplete response: expected 16 parameters, got ${entries.length}`);
        }

        const unitTypeValue = (entries[12].value['1'] << 8) | entries[12].value['0'];
        let unittypelabel = 'HRV Wi-Fi';
        switch (unitTypeValue) {
          case 17: unittypelabel = 'Breezy 160'; break;
          case 20: unittypelabel = 'Breezy Eco 160'; break;
          case 22: unittypelabel = 'Breezy 200'; break;
          case 24: unittypelabel = 'Breezy Eco 200'; break;
          default: unittypelabel = `HRV Wi-Fi (type ${unitTypeValue})`; break;
        }

        return {
          onoff: entries[0].value['0'],
          speed: {
            mode: entries[1].value['0'],
            manualspeed: entries[2].value['0'],
          },
          timers: {
            mode: entries[3].value['0'],
            countdown: {
              sec: entries[4].value['0'],
              min: entries[4].value['1'],
              hour: entries[4].value['2'],
            },
          },
          operationmode: entries[5].value['0'],
          humidity: {
            current: entries[6].value['0'],
            sensoractivation: entries[13].value['0'],
            threshold: entries[14].value['0'],
          },
          fan: {
            rpm1: (entries[7].value['1'] << 8) | entries[7].value['0'],
            rpm2: (entries[8].value['1'] << 8) | entries[8].value['0'],
          },
          filter: {
            alarm: entries[9].value['0'],
            timer: {
              min: entries[10].value['0'],
              hour: entries[10].value['1'],
              days: (entries[10].value['3'] << 8) | entries[10].value['2'],
            },
          },
          alarm: entries[11].value['0'],
          unittype: unittypelabel,
          co2sensor: entries[15].value['0'],
        };
      }
      throw new Error('device not responding, is your device password correct?');
    });
  }

  // Multi-interface discovery (directed broadcast per NIC + global broadcast),
  // falling back to the library's single-broadcast implementation if it yields
  // nothing - so existing setups can never regress.
  async discoverAll() {
    let locatedDevices = await discoverDevices({
      timeout: this.modbusClient.timeout,
      sizeResolver: this.modbusClient.parameterSizeResolver,
      log: (msg) => this.log(msg),
    });
    if (!locatedDevices || locatedDevices.length === 0) {
      const fallback = await this.modbusClient.findDevices();
      if (fallback && fallback.length > 0) {
        this.log(`Discovery: library fallback located ${fallback.length} device(s)`);
        locatedDevices = fallback;
      }
    }
    return locatedDevices || [];
  }

  async locateDevices() {
    const locatedDevices = await this.discoverAll();
    const oldamount = this.deviceList.length;
    this.log(`Current we located ${oldamount} devices, lets see if we found more: amount located ${locatedDevices.length}`);
    const homeydevices = this.getDevices();
    locatedDevices.forEach((locatedDevice) => {
      const knowndevice = this.deviceList.find((device) => device.id === locatedDevice.id);
      if (!knowndevice) {
        this.log(`Located new device with id ${locatedDevice.id} remember it and initialize it`);
        this.deviceList.push(locatedDevice);
        const homeydevice = homeydevices.find((device) => device.getData().id === locatedDevice.id);
        if (homeydevice) {
          homeydevice.discovery(locatedDevice.id);
        } else {
          this.log('Located device is not added to Homey yet');
        }
      }
    });
    homeydevices.forEach((homeydevice) => {
      if (homeydevice.getAvailable()) {
        this.log(`We know this device [${homeydevice.getData().id}] already, lets refresh its state`);
        homeydevice.updateDeviceState();
      } else {
        this.log('Not getting the state since device is not available yet');
      }
    });
  }

  locateDeviceById(id) {
    return this.deviceList.find((e) => e.id === id);
  }

  async getDeviceType(device, devicepass) {
    const packet = new Packet(device.id, devicepass, FunctionType.READ, [
      DataEntry.of(BreezyParameter.UNIT_TYPE),
    ]);

    return this.modbusClient.send(packet, device.ip).then((result) => {
      if (result != null) {
        const unitType = (result.packet._dataEntries[0].value['1'] << 8) | result.packet._dataEntries[0].value['0'];
        this.log(`Device ${device.id} reports unit type: ${unitType}`);
        return unitType;
      }
      throw new Error('Unable to determine device type');
    }).catch((error) => {
      this.log(`Error getting device type: ${error.message}`);
      return null;
    });
  }

  isHrvDevice(unitType) {
    return unitType !== null && BreezyDeviceTypes.includes(unitType);
  }

  // Targeted unicast scan of a single IP for manual pairing. Returns the
  // device id from a SEARCH reply (password not required) and best-effort unit
  // type. Allows adding even unrecognised types so new/OEM units can be paired
  // and reported on.
  async scanIp(ip, devicePassword) {
    const result = await scanByIP(ip, {
      timeout: 2500,
      sizeResolver: this.modbusClient.parameterSizeResolver,
      log: (msg) => this.log(msg),
    });
    if (result == null) {
      return { success: false, message: `No device responded at ${ip} on UDP port 4000. The unit may use a different local protocol, or be on another subnet/VLAN than Homey.` };
    }
    if (!result.id) {
      return { success: false, message: `A device at ${ip} replied but not in the expected b133 format. The raw reply has been logged for analysis.` };
    }
    const device = { id: result.id, ip: result.ip };
    let unitType = null;
    try {
      unitType = await this.getDeviceType(device, devicePassword);
    } catch (error) {
      this.log(`Manual scan: could not read unit type (password may differ): ${error.message}`);
    }
    const recognised = this.isHrvDevice(unitType);
    this.log(`Manual scan: ${ip} -> id ${result.id}, unitType ${unitType}, recognised HRV: ${recognised}`);
    return {
      success: true,
      deviceId: result.id,
      ip: result.ip,
      unitType,
      recognised,
      name: recognised ? `HRV Wi-Fi ${result.id}` : `Blauberg unit ${result.id}`,
    };
  }

  async onPair(session) {
    const devicePassword = '1111'; // Default password

    session.setHandler('set_discovery_mode', async (data) => {
      this.log(`Pairing discovery mode: ${data && data.mode}`);
      if (data && data.mode === 'auto') {
        await this.locateDevices();
      }
      return true;
    });

    session.setHandler('scan_ip', async (data) => {
      const ip = (data && data.ip ? data.ip : '').trim();
      this.log(`Manual IP scan requested for: ${ip}`);
      if (!ip) return { success: false, message: 'No IP address provided' };
      try {
        return await this.scanIp(ip, devicePassword);
      } catch (error) {
        this.log(`Manual IP scan error: ${error.message}`);
        return { success: false, message: `Scan failed: ${error.message}` };
      }
    });

    session.setHandler('list_devices', async (data) => {
      this.log('Provide user list of discovered HRV Wi-Fi devices');
      await this.locateDevices();
      this.log(JSON.stringify(this.deviceList));
      this.log(`Located [${this.deviceList.length}] devices total`);

      const hrvDevices = [];
      for (const device of this.deviceList) {
        const unitType = await this.getDeviceType(device, devicePassword);
        if (this.isHrvDevice(unitType)) {
          this.log(`Device ${device.id} is an HRV Wi-Fi device (type ${unitType})`);
          hrvDevices.push(device);
        } else {
          this.log(`Device ${device.id} is not an HRV Wi-Fi device (type ${unitType}), skipping`);
        }
      }

      this.log(`Filtered to [${hrvDevices.length}] HRV Wi-Fi devices`);

      return hrvDevices.map((device) => ({
        id: device.id,
        name: `HRV Wi-Fi ${device.id}`,
        data: { id: device.id },
      }));
    });

    session.setHandler('add_devices', async (data) => {
      await session.showView('add_devices');
      if (data.length > 0) {
        this.log(`HRV Wi-Fi device [${data[0].name}] added`);
      } else {
        this.log('No HRV Wi-Fi device added');
      }
    });
  }

}

module.exports = HrvWifiDriver;
