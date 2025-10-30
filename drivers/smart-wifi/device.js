'use strict';

const { Device } = require('homey');

class SmartWiFiDevice extends Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    const { id } = this.getData();
    this.log(`Locating Smart Wi-Fi device with id ${id}`);
    await this.discovery(id);
    await this.updateCapabilities();
    await this.setupCapabilities();
  }

  async updateCapabilities() {
    // Add any missing capabilities dynamically
    if (!this.hasCapability('alarm_connectivity')) {
      await this.addCapability('alarm_connectivity');
    }
    if (!this.hasCapability('alarm_battery')) {
      await this.addCapability('alarm_battery');
    }
  }

  async setupCapabilities() {
    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener(
        'onoff',
        this.onCapabilityOnoff.bind(this)
      );
    }
    if (this.hasCapability('alarm_boost')) {
      this.registerCapabilityListener(
        'alarm_boost',
        this.onCapabilityBoost.bind(this)
      );
      await this.setupFlowBoost();
    }
    if (this.hasCapability('alarm_battery')) {
      await this.setupFlowBattery();
    }
    if (this.hasCapability('dim')) {
      this.registerCapabilityListener('dim', this.onCapabilityDim.bind(this));
    }
    // Setup silent mode flow card
    await this.setupFlowSilentMode();
  }

  async discovery(id) {
    this.deviceObject = this.driver.locateDeviceById(id);
    if (this.deviceObject == null) {
      // Try to use last known IP if discovery failed
      const lastKnownIP = this.getStoreValue('lastKnownIP');
      if (lastKnownIP && lastKnownIP !== '0.0.0.0') {
        this.log(
          `Discovery failed, attempting to use last known IP: ${lastKnownIP}`
        );
        this.deviceObject = {
          id,
          ip: lastKnownIP,
        };
        // Test if device responds at this IP
        try {
          this.devicepwd = await this.getSetting('devicepwd');
          const state = await this.driver.getDeviceState(
            this.deviceObject,
            this.devicepwd
          );
          if (state) {
            await this.setAvailable();
            this.log(
              `Smart Wi-Fi device reconnected using last known IP: [${lastKnownIP}]`
            );
            return;
          }
        } catch (error) {
          this.log(`Failed to connect using last known IP: ${error.message}`);
        }
      }
      await this.setUnavailable('Device not discovered yet');
      this.log('Smart Wi-Fi device could not be located');
    } else {
      await this.setAvailable();
      this.log(`Smart Wi-Fi device initialized: [${this.deviceObject.ip}]`);
      this.devicepwd = await this.getSetting('devicepwd');
      // Store IP address for future fallback
      await this.setStoreValue('lastKnownIP', this.deviceObject.ip);
      await this.setSettings({ last_known_ip: this.deviceObject.ip });
    }
  }

  async updateDeviceState() {
    this.log('Requesting current device state');
    const state = await this.driver
      .getDeviceState(this.deviceObject, this.devicepwd)
      .catch(async (error) => {
        this.log(`Error getting device state: ${error.message}`);
        await this.setCapabilityValue('alarm_connectivity', true);
      });

    if (state === undefined) {
      return;
    }

    await this.setCapabilityValue('alarm_connectivity', false);

    // Update stored IP if it changed (device might have gotten new DHCP address)
    const currentStoredIP = this.getStoreValue('lastKnownIP');
    if (
      this.deviceObject &&
      this.deviceObject.ip &&
      currentStoredIP !== this.deviceObject.ip
    ) {
      this.log(
        `Device IP changed from ${currentStoredIP} to ${this.deviceObject.ip}`
      );
      await this.setStoreValue('lastKnownIP', this.deviceObject.ip);
      await this.setSettings({ last_known_ip: this.deviceObject.ip });
    }

    this.log(JSON.stringify(state));

    // Store old values to detect changes
    const oldBattery = this.getCapabilityValue('alarm_battery');
    const oldBoost = this.getCapabilityValue('alarm_boost');

    // Update capabilities
    await this.setCapabilityValue('onoff', state.onoff === 1);

    const newBattery = state.battery === 0;
    await this.setCapabilityValue('alarm_battery', newBattery);
    if (oldBattery !== null && oldBattery !== newBattery) {
      await this.triggerBatteryAlarm(newBattery);
    }

    const newBoost = state.boost.mode === 1;
    await this.setCapabilityValue('alarm_boost', newBoost);
    if (oldBoost !== null && oldBoost !== newBoost) {
      await this.triggerBoostAlarm(newBoost);
    }

    await this.setCapabilityValue('measure_RPM', state.fan.rpm);

    // Update speed as percentage (0-100%)
    await this.setCapabilityValue('dim', state.speed.max / 100);

    // Update settings
    await this.setSettings({
      max_speed: state.speed.max,
      silent_speed: state.speed.silent,
      interval_speed: state.speed.interval,
      silent_mode: state.modes.silent === 1,
      interval_mode: state.modes.interval === 1,
      humidity_sensor: state.sensors.humidity === 1,
      temp_sensor: state.sensors.temperature === 1,
      motion_sensor: state.sensors.motion === 1,
    });
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('Smart Wi-Fi device has been added');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('devicepwd')) {
      this.devicepwd = newSettings.devicepwd;
      await this.updateDeviceState();
    }
    if (changedKeys.includes('last_known_ip')) {
      await this.setStoreValue('lastKnownIP', newSettings.last_known_ip);
    }
    if (changedKeys.includes('max_speed')) {
      await this.driver.setMaxSpeed(
        this.deviceObject,
        this.devicepwd,
        newSettings.max_speed
      );
    }
    if (changedKeys.includes('silent_speed')) {
      await this.driver.setSilentSpeed(
        this.deviceObject,
        this.devicepwd,
        newSettings.silent_speed
      );
    }
    if (changedKeys.includes('silent_mode')) {
      await this.driver.setSilentMode(
        this.deviceObject,
        this.devicepwd,
        newSettings.silent_mode ? 1 : 0
      );
    }
    if (changedKeys.includes('interval_mode')) {
      await this.driver.setIntervalMode(
        this.deviceObject,
        this.devicepwd,
        newSettings.interval_mode ? 1 : 0
      );
    }
  }

  async onCapabilityOnoff(value, opts) {
    if (value) {
      await this.driver.setOnoffStatus(this.deviceObject, this.devicepwd, 1);
    } else {
      await this.driver.setOnoffStatus(this.deviceObject, this.devicepwd, 0);
    }
  }

  async onCapabilityBoost(value, opts) {
    if (value) {
      await this.driver.setBoostMode(this.deviceObject, this.devicepwd, 1);
    } else {
      await this.driver.setBoostMode(this.deviceObject, this.devicepwd, 0);
    }
  }

  async onCapabilityDim(value, opts) {
    // Convert 0-1 to 30-100% (device min is 30%)
    const speedPercent = Math.round(30 + value * 70);
    await this.driver.setMaxSpeed(
      this.deviceObject,
      this.devicepwd,
      speedPercent
    );
  }

  async setupFlowBoost() {
    this.log('Setting up boost flow cards');
    // Register condition card
    this.homey.flow
      .getConditionCard('smartwifi_alarm_boost')
      .registerRunListener((args, state) => {
        return args.device.getCapabilityValue('alarm_boost');
      });

    // Register action card
    this._flowBoostAction = await this.homey.flow.getActionCard(
      'smartwifi_set_boost'
    );
    this._flowBoostAction.registerRunListener(async (args, state) => {
      this.log(`Setting boost mode to: ${args.boost}`);
      await this.setCapabilityValue('alarm_boost', args.boost);
      await this.driver.setBoostMode(
        args.device.deviceObject,
        args.device.devicepwd,
        args.boost ? 1 : 0
      );
    });
  }

  async setupFlowBattery() {
    this.log('Setting up battery flow cards');
    // Battery alarm triggers are handled in triggerBatteryAlarm()
  }

  async triggerBoostAlarm(isOn) {
    const triggerCard = isOn
      ? 'smartwifi_alarm_boost_true'
      : 'smartwifi_alarm_boost_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow
      .getDeviceTriggerCard(triggerCard)
      .trigger(this, {}, {});
  }

  async triggerBatteryAlarm(isOn) {
    const triggerCard = isOn
      ? 'smartwifi_alarm_battery_true'
      : 'smartwifi_alarm_battery_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow
      .getDeviceTriggerCard(triggerCard)
      .trigger(this, {}, {});
  }

  async setupFlowSilentMode() {
    this.log('Setting up silent mode flow card');
    this._flowSilentAction = await this.homey.flow.getActionCard(
      'smartwifi_set_silent_mode'
    );
    this._flowSilentAction.registerRunListener(async (args, state) => {
      this.log(`Setting silent mode to: ${args.silent}`);
      await this.driver.setSilentMode(
        args.device.deviceObject,
        args.device.devicepwd,
        args.silent ? 1 : 0
      );
    });
  }
}

module.exports = SmartWiFiDevice;
