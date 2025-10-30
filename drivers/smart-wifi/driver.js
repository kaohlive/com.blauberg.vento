'use strict';

const { Driver } = require('homey');
const {
  BlaubergVentoClient,
  Packet,
  FunctionType,
  DataEntry,
} = require('blaubergventojs');
const { SmartWiFiParameter } = require('../../lib/smart-wifi-parameters');

class SmartWiFiDriver extends Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.deviceList = [];
    this.modbusClient = new BlaubergVentoClient();
    this.modbusClient.timeout = 1500;
    this.log('Smart Wi-Fi driver has been initialized');
    this.homey.setTimeout(async () => {
      await this.locateDevices();
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
      this.log(JSON.stringify(result));
    });
  }

  async setOnoffStatus(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      SmartWiFiParameter.FAN_ONOFF,
      value
    );
  }

  async setBoostMode(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      SmartWiFiParameter.BOOST_MODE,
      value
    );
  }

  async setMaxSpeed(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      SmartWiFiParameter.MAX_SPEED_SETPOINT,
      value
    );
  }

  async setSilentSpeed(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      SmartWiFiParameter.SILENT_SPEED_SETPOINT,
      value
    );
  }

  async setSilentMode(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      SmartWiFiParameter.SILENT_MODE_ACTIVATION,
      value
    );
  }

  async setIntervalMode(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      SmartWiFiParameter.INTERVAL_MODE_ACTIVATION,
      value
    );
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
        return {
          onoff: result.packet._dataEntries[0].value['0'],
          battery: result.packet._dataEntries[1].value['0'],
          fan: {
            rpm:
              (result.packet._dataEntries[2].value['1'] << 8) |
              result.packet._dataEntries[2].value['0'],
          },
          boost: {
            mode: result.packet._dataEntries[3].value['0'],
            countdown: {
              sec: result.packet._dataEntries[4].value['0'],
              min: result.packet._dataEntries[4].value['1'],
              hour: result.packet._dataEntries[4].value['2'],
            },
          },
          status: {
            timer: result.packet._dataEntries[5].value['0'],
            humidity: result.packet._dataEntries[6].value['0'],
            temperature: result.packet._dataEntries[7].value['0'],
            motion: result.packet._dataEntries[8].value['0'],
            externalSwitch: result.packet._dataEntries[9].value['0'],
            intervalMode: result.packet._dataEntries[10].value['0'],
            silentMode: result.packet._dataEntries[11].value['0'],
          },
          speed: {
            max: result.packet._dataEntries[12].value['0'],
            silent: result.packet._dataEntries[13].value['0'],
            interval: result.packet._dataEntries[14].value['0'],
          },
          modes: {
            silent: result.packet._dataEntries[15].value['0'],
            interval: result.packet._dataEntries[16].value['0'],
          },
          sensors: {
            humidity: result.packet._dataEntries[17].value['0'],
            temperature: result.packet._dataEntries[18].value['0'],
            motion: result.packet._dataEntries[19].value['0'],
          },
          unittype:
            (result.packet._dataEntries[20].value['1'] << 8) |
            result.packet._dataEntries[20].value['0'],
        };
      }
      throw new Error(
        'device not responding, is your device password correct?'
      );
    });
  }

  async locateDevices() {
    const locatedDevices = await this.modbusClient.findDevices();
    const oldamount = this.deviceList.length;
    this.log(
      `Currently located ${oldamount} devices, found ${locatedDevices.length} devices`
    );
    const homeydevices = this.getDevices();

    locatedDevices.forEach((locatedDevice) => {
      const knowndevice = this.deviceList.find(
        (device) => device.id === locatedDevice.id
      );
      if (!knowndevice) {
        this.log(`Located new device with id ${locatedDevice.id}`);
        this.deviceList.push(locatedDevice);
        const homeydevice = homeydevices.find(
          (device) => device.getData().id === locatedDevice.id
        );
        if (homeydevice) {
          homeydevice.discovery(locatedDevice.id);
        } else {
          this.log('Located device is not added to Homey yet');
        }
      }
    });

    homeydevices.forEach((homeydevice) => {
      if (homeydevice.getAvailable()) {
        this.log(`Refreshing state for device [${homeydevice.getData().id}]`);
        homeydevice.updateDeviceState();
      } else {
        this.log('Device not available yet');
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

    return this.modbusClient
      .send(packet, device.ip)
      .then((result) => {
        if (result != null) {
          const unitType =
            (result.packet._dataEntries[0].value['1'] << 8) |
            result.packet._dataEntries[0].value['0'];
          this.log(`Device ${device.id} reports unit type: ${unitType}`);
          return unitType;
        }
        throw new Error('Unable to determine device type');
      })
      .catch((error) => {
        this.log(`Error getting device type: ${error.message}`);
        return null;
      });
  }

  isSmartWiFiDevice(unitType) {
    // Smart Wi-Fi devices return values other than 3, 4, or 5
    // Vento Expert uses 3, 4, 5, so anything else is Smart Wi-Fi
    return (
      unitType !== null && unitType !== 3 && unitType !== 4 && unitType !== 5
    );
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
          this.log(
            `Device ${device.id} is a Smart Wi-Fi device (type ${unitType})`
          );
          smartWiFiDevices.push(device);
        } else {
          this.log(
            `Device ${device.id} is not a Smart Wi-Fi device (type ${unitType}), skipping`
          );
        }
      }

      this.log(`Filtered to [${smartWiFiDevices.length}] Smart Wi-Fi devices`);

      // Return the mapped list of Smart Wi-Fi devices only
      return smartWiFiDevices.map((device) => {
        const smartwifidevice = {
          id: device.id,
          name: `Smart Wi-Fi ${device.id}`,
          data: {
            id: device.id,
          },
        };
        this.log(`Located: ${JSON.stringify(smartwifidevice)}`);
        return smartwifidevice;
      });
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
