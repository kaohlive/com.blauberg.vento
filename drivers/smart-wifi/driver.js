'use strict';

const { Driver } = require('homey');
const {
  BlaubergVentoClient, Packet, FunctionType, DataEntry,
} = require('blaubergventojs');
const { SmartWiFiParameter, SmartWiFiParameterSizes } = require('../../lib/smart-wifi-parameters');

class SmartWiFiDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.deviceList = [];
    this.modbusClient = new BlaubergVentoClient();
    this.modbusClient.timeout = 1500;
    this.modbusClient.parameterSizeResolver = (param) => {
      const size = SmartWiFiParameterSizes[param];
      return size !== undefined ? size : -1;
    };
    this.log('Smart Wi-Fi driver has been initialized');
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
    return this.setDeviceValue(device, devicepass, SmartWiFiParameter.FAN_ONOFF, value);
  }

  async setBoostMode(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, SmartWiFiParameter.BOOST_MODE, value);
  }

  async setMaxSpeed(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, SmartWiFiParameter.MAX_SPEED_SETPOINT, value);
  }

  async setSilentSpeed(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, SmartWiFiParameter.SILENT_SPEED_SETPOINT, value);
  }

  async setSilentMode(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, SmartWiFiParameter.SILENT_MODE_ACTIVATION, value);
  }

  async setIntervalMode(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, SmartWiFiParameter.INTERVAL_MODE_ACTIVATION, value);
  }

  async getDeviceState(device, devicepass) {
    // Assemble package for reading device state
    const packet = new Packet(device.id, devicepass, FunctionType.READ, [
      DataEntry.of(SmartWiFiParameter.FAN_ONOFF),
      DataEntry.of(SmartWiFiParameter.BATTERY_STATUS),
      DataEntry.of(SmartWiFiParameter.CURRENT_RPM),
      DataEntry.of(SmartWiFiParameter.BOOST_MODE),
      DataEntry.of(SmartWiFiParameter.BOOST_TIMER_COUNTDOWN),
      DataEntry.of(SmartWiFiParameter.STATUS_BUILTIN_TIMER),
      DataEntry.of(SmartWiFiParameter.STATUS_HUMIDITY_SENSOR),
      DataEntry.of(SmartWiFiParameter.STATUS_TEMP_SENSOR),
      DataEntry.of(SmartWiFiParameter.STATUS_MOTION_SENSOR),
      DataEntry.of(SmartWiFiParameter.STATUS_EXTERNAL_SWITCH),
      DataEntry.of(SmartWiFiParameter.STATUS_INTERVAL_MODE),
      DataEntry.of(SmartWiFiParameter.STATUS_SILENT_MODE),
      DataEntry.of(SmartWiFiParameter.MAX_SPEED_SETPOINT),
      DataEntry.of(SmartWiFiParameter.SILENT_SPEED_SETPOINT),
      DataEntry.of(SmartWiFiParameter.INTERVAL_SPEED_SETPOINT),
      DataEntry.of(SmartWiFiParameter.SILENT_MODE_ACTIVATION),
      DataEntry.of(SmartWiFiParameter.INTERVAL_MODE_ACTIVATION),
      DataEntry.of(SmartWiFiParameter.HUMIDITY_SENSOR_PERMISSION),
      DataEntry.of(SmartWiFiParameter.TEMP_SENSOR_PERMISSION),
      DataEntry.of(SmartWiFiParameter.MOTION_SENSOR_PERMISSION),
      DataEntry.of(SmartWiFiParameter.UNIT_TYPE),
    ]);

    // Send package and wait for response
    return this.modbusClient.send(packet, device.ip).then((result) => {
      if (result != null) {
        const entries = result.packet._dataEntries;
        if (entries.length < 21) {
          this.log(`Warning: expected 21 data entries, got ${entries.length}`);
          throw new Error(`Incomplete response: expected 21 parameters, got ${entries.length}`);
        }
        return {
          onoff: entries[0].value['0'],
          battery: entries[1].value['0'],
          fan: {
            rpm: (entries[2].value['1'] << 8) | entries[2].value['0'],
          },
          boost: {
            mode: entries[3].value['0'],
            countdown: {
              sec: entries[4].value['0'],
              min: entries[4].value['1'],
              hour: entries[4].value['2'],
            },
          },
          status: {
            timer: entries[5].value['0'],
            humidity: entries[6].value['0'],
            temperature: entries[7].value['0'],
            motion: entries[8].value['0'],
            externalSwitch: entries[9].value['0'],
            intervalMode: entries[10].value['0'],
            silentMode: entries[11].value['0'],
          },
          speed: {
            max: entries[12].value['0'],
            silent: entries[13].value['0'],
            interval: entries[14].value['0'],
          },
          modes: {
            silent: entries[15].value['0'],
            interval: entries[16].value['0'],
          },
          sensors: {
            humidity: entries[17].value['0'],
            temperature: entries[18].value['0'],
            motion: entries[19].value['0'],
          },
          unittype: (entries[20].value['1'] << 8) | entries[20].value['0'],
        };
      }
      throw new Error('device not responding, is your device password correct?');
    });
  }

  async locateDevices() {
    const locatedDevices = await this.modbusClient.findDevices();
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
    // Now lets ask all our homey enabled devices to update their state
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
    // Query parameter 0x00B9 (UNIT_TYPE) to determine device type
    const packet = new Packet(device.id, devicepass, FunctionType.READ, [
      DataEntry.of(SmartWiFiParameter.UNIT_TYPE),
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

  isSmartWiFiDevice(unitType) {
    // Smart Wi-Fi devices return values not used by other drivers
    // Vento Expert-compatible: 3, 4, 5, 14, 26, 27, 28
    // HRV Wi-Fi (Breezy): 17, 20, 22, 24
    // Unsupported: 13 (Arc Smart)
    return unitType !== null && ![3, 4, 5, 13, 14, 17, 20, 22, 24, 26, 27, 28].includes(unitType);
  }

  async onPair(session) {
    const devicePassword = '1111'; // Default password

    session.setHandler('list_devices', async (data) => {
      this.log('Provide user list of discovered Smart Wi-Fi fans');
      await this.locateDevices();
      this.log(JSON.stringify(this.deviceList));
      this.log(`Located [${this.deviceList.length}] devices total`);

      // Filter devices by checking unit type
      const smartWiFiDevices = [];
      for (const device of this.deviceList) {
        const unitType = await this.getDeviceType(device, devicePassword);
        if (this.isSmartWiFiDevice(unitType)) {
          this.log(`Device ${device.id} is a Smart Wi-Fi device (type ${unitType})`);
          smartWiFiDevices.push(device);
        } else {
          this.log(`Device ${device.id} is not a Smart Wi-Fi device (type ${unitType}), skipping`);
        }
      }

      this.log(`Filtered to [${smartWiFiDevices.length}] Smart Wi-Fi devices`);

      // Return the mapped list of Smart Wi-Fi devices only
      return smartWiFiDevices.map((device) => ({
        id: device.id,
        name: `Smart Wi-Fi ${device.id}`,
        data: { id: device.id },
      }));
    });

    session.setHandler('add_devices', async (data) => {
      await session.showView('add_devices');
      if (data.length > 0) {
        this.log(`Smart Wi-Fi fan [${data[0].name}] added`);
      } else {
        this.log('No Smart Wi-Fi fan added');
      }
    });
  }

}

module.exports = SmartWiFiDriver;
