'use strict';

const { Driver } = require('homey');
const {
  BlaubergVentoClient, Packet, FunctionType, DataEntry,
} = require('blaubergventojs');
const { SmartWiFiParameter, SmartWiFiParameterSizes } = require('../../lib/smart-wifi-parameters');
const { discoverDevices, scanByIP } = require('../../lib/device-discovery');
const { sendWithRetry } = require('../../lib/modbus-retry');

class SmartWiFiDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.deviceList = [];
    this.modbusClient = new BlaubergVentoClient();
    this.modbusClient.timeout = 1500;
    this.modbusClient.parameterSizeResolver = (param) => {
      // Special-command bytes that can appear in a controller response are each
      // followed by exactly one byte: 0xFC (change function), 0xFD (parameter
      // not supported -> low byte of the param), 0xFF (change page -> new high
      // byte). Report size 1 so the library's parser consumes the marker and
      // its trailing byte and CONTINUES, instead of aborting the whole response
      // at the first not-supported parameter. (0xFE size-command is handled by
      // the library itself.) A device that supports only a subset of the
      // requested parameters (e.g. iFan) is then parsed correctly.
      if (param === 0xFC || param === 0xFD || param === 0xFF) return 1;
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

    // Send package and wait for response (retry to absorb transient UDP loss).
    return sendWithRetry(this.modbusClient, packet, device.ip, { attempts: 3, log: (m) => this.log(m) }).then((result) => {
      if (result == null) {
        throw new Error('device not responding, is your device password correct?');
      }

      // Parse the response by parameter id rather than by position: a device may
      // support only a subset of the requested parameters and reports the rest
      // with a 0xFD "not supported" marker (value byte = the unsupported param).
      // Building a map keeps us correct regardless of which params come back and
      // in what order.
      const P = SmartWiFiParameter;
      const values = new Map();
      const unsupported = [];
      for (const entry of result.packet._dataEntries) {
        if (entry.parameter === 0xFD) {
          if (entry.value && entry.value.length) unsupported.push(entry.value[0]);
        } else if (entry.parameter !== 0xFC && entry.parameter !== 0xFF) {
          values.set(entry.parameter, entry.value);
        }
      }
      if (unsupported.length) {
        this.log(`Device does not support parameter(s): ${unsupported
          .map((p) => `0x${p.toString(16).padStart(2, '0')}`).join(', ')}`);
      }
      if (values.size === 0) {
        throw new Error('device returned no readable parameters');
      }

      // Readers that return undefined when the parameter is absent.
      const b = (param) => {
        const v = values.get(param);
        return v ? v[0] : undefined;
      };
      const w = (param) => {
        const v = values.get(param);
        return v ? ((v[1] << 8) | v[0]) : undefined;
      };
      const countdown = values.get(P.BOOST_TIMER_COUNTDOWN);

      return {
        onoff: b(P.FAN_ONOFF),
        battery: b(P.BATTERY_STATUS),
        fan: {
          rpm: w(P.CURRENT_RPM),
        },
        boost: {
          mode: b(P.BOOST_MODE),
          countdown: countdown
            ? { sec: countdown[0], min: countdown[1], hour: countdown[2] }
            : undefined,
        },
        status: {
          timer: b(P.STATUS_BUILTIN_TIMER),
          humidity: b(P.STATUS_HUMIDITY_SENSOR),
          temperature: b(P.STATUS_TEMP_SENSOR),
          motion: b(P.STATUS_MOTION_SENSOR),
          externalSwitch: b(P.STATUS_EXTERNAL_SWITCH),
          intervalMode: b(P.STATUS_INTERVAL_MODE),
          silentMode: b(P.STATUS_SILENT_MODE),
        },
        speed: {
          max: b(P.MAX_SPEED_SETPOINT),
          silent: b(P.SILENT_SPEED_SETPOINT),
          interval: b(P.INTERVAL_SPEED_SETPOINT),
        },
        modes: {
          silent: b(P.SILENT_MODE_ACTIVATION),
          interval: b(P.INTERVAL_MODE_ACTIVATION),
        },
        sensors: {
          humidity: b(P.HUMIDITY_SENSOR_PERMISSION),
          temperature: b(P.TEMP_SENSOR_PERMISSION),
          motion: b(P.MOTION_SENSOR_PERMISSION),
        },
        unittype: w(P.UNIT_TYPE),
        // Diagnostics for the device layer (capability pruning).
        present: Array.from(values.keys()),
        unsupported,
      };
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

    return sendWithRetry(this.modbusClient, packet, device.ip, { attempts: 3, log: (m) => this.log(m) }).then((result) => {
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
    const recognised = this.isSmartWiFiDevice(unitType);
    this.log(`Manual scan: ${ip} -> id ${result.id}, unitType ${unitType}, recognised Smart Wi-Fi: ${recognised}`);
    return {
      success: true,
      deviceId: result.id,
      ip: result.ip,
      unitType,
      recognised,
      name: recognised ? `Smart Wi-Fi ${result.id}` : `Blauberg unit ${result.id}`,
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
