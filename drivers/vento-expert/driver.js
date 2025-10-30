'use strict';

const { Driver } = require('homey');
const {
  BlaubergVentoClient,
  Packet,
  FunctionType,
  Parameter,
  DataEntry,
} = require('blaubergventojs');

class VentoDriver extends Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.deviceList = [];
    this.modbusClient = new BlaubergVentoClient();
    this.modbusClient.timeout = 1500;
    this.log('Vento driver has been initialized');
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
      // Check result
      this.log(JSON.stringify(result));
    });
  }

  async setOnoffStatus(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, Parameter.ON_OFF, value);
  }

  async setSpeedMode(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, Parameter.SPEED, value);
  }

  async setOperationMode(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      Parameter.VENTILATION_MODE,
      value
    );
  }

  async setTimerMode(device, devicepass, value) {
    return this.setDeviceValue(device, devicepass, Parameter.TIMER_MODE, value);
  }

  async setManualSpeed(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      Parameter.MANUAL_SPEED,
      value
    );
  }

  async setHumiditySensor(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      Parameter.HUMIDITY_SENSOR_ACTIVATION,
      value
    );
  }

  async setHumiditySensorThreshold(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      Parameter.HUMIDITY_THRESHOLD,
      value
    );
  }

  async setBoostDelay(device, devicepass, value) {
    return this.setDeviceValue(
      device,
      devicepass,
      Parameter.BOOST_MODE_DEACTIVATION_DELAY,
      value
    );
  }

  async getDeviceState(device, devicepass) {
    // Assemble package for reading ON_OFF state
    const packet = new Packet(device.id, devicepass, FunctionType.READ, [
      DataEntry.of(Parameter.ON_OFF),
      DataEntry.of(Parameter.SPEED),
      DataEntry.of(Parameter.MANUAL_SPEED),
      DataEntry.of(Parameter.BOOT_MODE),
      DataEntry.of(Parameter.BOOST_MODE_DEACTIVATION_DELAY),
      DataEntry.of(Parameter.VENTILATION_MODE),
      DataEntry.of(Parameter.FILTER_ALARM),
      DataEntry.of(Parameter.FILTER_TIMER),
      DataEntry.of(Parameter.CURRENT_HUMIDITY),
      DataEntry.of(Parameter.HUMIDITY_SENSOR_ACTIVATION),
      DataEntry.of(Parameter.HUMIDITY_THRESHOLD),
      DataEntry.of(Parameter.UNIT_TYPE),
      DataEntry.of(Parameter.FAN1RPM),
      DataEntry.of(Parameter.TIMER_MODE),
      DataEntry.of(Parameter.READ_ALARM),
      DataEntry.of(11), // Active timer countdown
    ]);
    // Send package and wait for response.
    return this.modbusClient.send(packet, device.ip).then((result) => {
      if (result != null) {
        let unittypelabel = 'Vento Expert';
        switch (result.packet._dataEntries[11]?.value?.['0']) {
          case 1:
            unittypelabel =
              'Vento Expert A50-1 W V.2 | Vento Expert A85-1 W V.2 | Vento Expert A100-1 W V.2';
            break;
          case 4:
            unittypelabel = 'Vento Expert Duo A30-1 W V.2';
            break;
          case 5:
            unittypelabel = 'Vento Expert A30 W V.2';
            break;
          default:
            unittypelabel = 'Vento Expert';
            break;
        }
        return {
          onoff: result.packet._dataEntries[0].value?.['0'],
          speed: {
            mode: result.packet._dataEntries[1].value?.['0'],
            manualspeed: result.packet._dataEntries[2].value?.['0'],
          },
          boost: {
            mode: result.packet._dataEntries[3].value?.['0'],
            deactivationtimer: result.packet._dataEntries[4].value?.['0'],
          },
          operationmode: result.packet._dataEntries[5].value?.['0'],
          filter: {
            alarm: result.packet._dataEntries[6].value?.['0'],
            timer: {
              min: result.packet._dataEntries[7].value?.['0'],
              hour: result.packet._dataEntries[7].value?.['1'],
              days: result.packet._dataEntries[7].value?.['2'],
            },
          },
          humidity: {
            current: result.packet._dataEntries[8].value?.['0'],
            sensoractivation: result.packet._dataEntries[9].value?.['0'],
            threshold: result.packet._dataEntries[10].value?.['0'],
            activated: 0,
          },
          unittype: unittypelabel,
          fan: {
            rpm: result.packet._dataEntries[12].value?.['0'],
          },
          timers: {
            mode: result.packet._dataEntries[13].value?.['0'],
            countdown: {
              sec: result.packet._dataEntries[15].value?.['0'],
              min: result.packet._dataEntries[15].value?.['1'],
              hour: result.packet._dataEntries[15].value?.['2'],
            },
          },
          alarm: result.packet._dataEntries[14].value?.['0'],
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
      `Current we located ${oldamount} devices, lets see if we found more: amount located ${locatedDevices.length}`
    );
    const homeydevices = this.getDevices(); // We want to be able to tell any non initialized devices they are ready for use
    locatedDevices.forEach((locatedDevice) => {
      // Lets see if we already knew about this device
      const knowndevice = this.deviceList.find(
        (device) => device.id === locatedDevice.id
      );
      if (!knowndevice) {
        this.log(
          `Located new device with id ${locatedDevice.id} remember it and initialize it`
        );
        this.deviceList.push(locatedDevice); // So we remember the located device and its IP
        const homeydevice = homeydevices.find(
          (device) => device.getData().id === locatedDevice.id
        );
        if (homeydevice) {
          homeydevice.discovery(locatedDevice.id);
        } else this.log('Located device is not added to Homey yet');
      }
    });
    // Now lets ask all our homey enabled devices to update their state
    homeydevices.forEach((homeydevice) => {
      if (homeydevice.getAvailable()) {
        this.log(
          `We know this device [${
            homeydevice.getData().id
          }] already, lets refresh its state`
        );
        homeydevice.updateDeviceState();
      } else {
        this.log('Not getting the state since device is not available yet');
      }
    });
  }

  locateDeviceById(id) {
    return this.deviceList.find((e) => {
      return e.id === id;
    });
  }

  async getDeviceType(device, devicepass) {
    // Query parameter 0x00B9 (UNIT_TYPE) to determine device type
    const packet = new Packet(device.id, devicepass, FunctionType.READ, [
      DataEntry.of(0x00b9), // UNIT_TYPE parameter
    ]);

    return this.modbusClient
      .send(packet, device.ip)
      .then((result) => {
        if (result != null) {
          const unitType =
            (result.packet._dataEntries[0].value?.['1'] << 8) |
            result.packet._dataEntries[0].value?.['0'];
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

  isVentoExpertDevice(unitType) {
    // Vento Expert devices return 3, 4, or 5
    // 3: Vento Expert A50-1/A85-1/A100-1 W V.2
    // 4: Vento Expert Duo A30-1 W V.2
    // 5: Vento Expert A30 W V.2
    return unitType === 3 || unitType === 4 || unitType === 5;
  }

  async onPair(session) {
    const devicePassword = '1111'; // Default password

    session.setHandler('list_devices', async (data) => {
      this.log('Provide user list of discovered Vento fans to choose from.');
      this.log('Start discovery of Vento Expert devices on the local network');
      await this.locateDevices();
      this.log(JSON.stringify(this.deviceList));
      this.log(`Located [${this.deviceList.length}] devices total`);

      // Filter devices by checking unit type
      const ventoExpertDevices = [];
      for (const device of this.deviceList) {
        const unitType = await this.getDeviceType(device, devicePassword);
        if (unitType !== null && this.isVentoExpertDevice(unitType)) {
          this.log(`Device ${device.id} is a Vento Expert (type ${unitType})`);
          ventoExpertDevices.push(device);
        } else {
          this.log(
            `Device ${device.id} is not a Vento Expert (type ${unitType}), skipping`
          );
        }
      }

      this.log(
        `Filtered to [${ventoExpertDevices.length}] Vento Expert devices`
      );

      // Return the mapped list of Vento Expert devices only
      return ventoExpertDevices.map((device) => {
        this.log(JSON.stringify(device));
        const ventodevice = {
          id: device.id,
          name: `Vento Expert ${device.id}`,
          data: {
            id: device.id,
          },
        };
        this.log(`located: ${JSON.stringify(ventodevice)}`);
        return ventodevice;
      });
    });

    session.setHandler('add_devices', async (data) => {
      await session.showView('add_devices');
      if (data.length > 0) {
        this.log(`Vento fan [${data[0].name}] added`);
      } else this.log('no Vento fan added');
    });
  }
}

module.exports = VentoDriver;
