'use strict';

const { Device } = require('homey');

class HrvWifiDevice extends Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    const { id } = this.getData();
    this.log(`Locating HRV Wi-Fi device with id ${id}`);
    await this.discovery(id);
    await this.updateCapabilities();
    await this.setupCapabilities();
  }

  async updateCapabilities() {
    if (!this.hasCapability('fan_speed')) {
      await this.addCapability('fan_speed');
    }
    if (!this.hasCapability('alarm_connectivity')) {
      await this.addCapability('alarm_connectivity');
    }
    if (!this.hasCapability('button_reset_filter')) {
      await this.addCapability('button_reset_filter');
    }
  }

  async setupCapabilities() {
    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    }
    if (this.hasCapability('breezy_speed_mode')) {
      this.registerCapabilityListener('breezy_speed_mode', this.onCapabilitySpeedMode.bind(this));
      await this.setupFlowSpeedMode();
    }
    if (this.hasCapability('manualSpeed')) {
      this.registerCapabilityListener('manualSpeed', this.onCapabilityManualSpeed.bind(this));
      await this.setupFlowManualSpeed();
    }
    if (this.hasCapability('fan_speed')) {
      this.registerCapabilityListener('fan_speed', this.onCapabilityFanSpeed.bind(this));
    }
    if (this.hasCapability('breezy_operation_mode')) {
      this.registerCapabilityListener('breezy_operation_mode', this.onCapabilityOperationMode.bind(this));
      await this.setupFlowOperationMode();
    }
    if (this.hasCapability('breezy_timer_mode')) {
      this.registerCapabilityListener('breezy_timer_mode', this.onCapabilityTimerMode.bind(this));
      await this.setupFlowTimerMode();
    }
    if (this.hasCapability('alarm_generic')) {
      this.homey.flow.getConditionCard('hrv_alarm_generic').registerRunListener((args, state) => {
        return args.device.getCapabilityValue('alarm_generic');
      });
    }
    if (this.hasCapability('alarm_boost')) {
      this.homey.flow.getConditionCard('hrv_alarm_boost').registerRunListener((args, state) => {
        return args.device.getCapabilityValue('alarm_boost');
      });
    }
    if (this.hasCapability('alarm_filter')) {
      this.homey.flow.getConditionCard('hrv_alarm_filter').registerRunListener((args, state) => {
        return args.device.getCapabilityValue('alarm_filter');
      });
    }
    if (this.hasCapability('button_reset_filter')) {
      this.registerCapabilityListener('button_reset_filter', this.onCapabilityResetFilter.bind(this));
      await this.setupFlowResetFilter();
    }
  }

  async discovery(id) {
    this.deviceObject = this.driver.locateDeviceById(id);
    if (this.deviceObject == null) {
      const lastKnownIP = this.getStoreValue('lastKnownIP');
      if (lastKnownIP && lastKnownIP !== '0.0.0.0') {
        this.log(`Discovery failed, attempting to use last known IP: ${lastKnownIP}`);
        this.deviceObject = {
          id,
          ip: lastKnownIP,
        };
        try {
          this.devicepwd = this.getSetting('devicepwd') || '1111';
          const state = await this.driver.getDeviceState(this.deviceObject, this.devicepwd);
          if (state) {
            await this.setAvailable();
            this.log(`HRV Wi-Fi device reconnected using last known IP: [${lastKnownIP}]`);
            return;
          }
        } catch (error) {
          this.log(`Failed to connect using last known IP: ${error.message}`);
        }
      }
      await this.setUnavailable('Device not discovered yet');
      this.log('HRV Wi-Fi device could not be located');
    } else {
      await this.setAvailable();
      this.log(`HRV Wi-Fi device initialized: [${this.deviceObject.ip}]`);
      this.devicepwd = this.getSetting('devicepwd') || '1111';
      await this.setStoreValue('lastKnownIP', this.deviceObject.ip);
      await this.setSettings({ last_known_ip: this.deviceObject.ip });
    }
  }

  async updateDeviceState() {
    this.log('Requesting current device state');
    const state = await this.driver.getDeviceState(this.deviceObject, this.devicepwd).catch(async (error) => {
      this.log(`Error getting device state: ${error.message}`);
      await this.setCapabilityValue('alarm_connectivity', true);
    });

    if (state === undefined) {
      return;
    }

    await this.setCapabilityValue('alarm_connectivity', false);
    await this.setStoreValue('lastSuccessfulConnection', Date.now());

    const currentStoredIP = this.getStoreValue('lastKnownIP');
    if (this.deviceObject && this.deviceObject.ip && currentStoredIP !== this.deviceObject.ip) {
      this.log(`Device IP changed from ${currentStoredIP} to ${this.deviceObject.ip}`);
      await this.setStoreValue('lastKnownIP', this.deviceObject.ip);
      await this.setSettings({ last_known_ip: this.deviceObject.ip });
    }

    this.log(JSON.stringify(state));

    // Store old values to detect changes
    const oldBoost = this.getCapabilityValue('alarm_boost');
    const oldFilter = this.getCapabilityValue('alarm_filter');
    const oldGeneric = this.getCapabilityValue('alarm_generic');

    // Update capabilities
    await this.setCapabilityValue('onoff', (state.onoff === 1));

    // Breezy doesn't have a dedicated boost parameter in state read,
    // but alarm_boost is part of the capability set for flow compatibility
    const newBoost = false;
    await this.setCapabilityValue('alarm_boost', newBoost);
    if (oldBoost !== null && oldBoost !== newBoost) {
      await this.triggerBoostAlarm(newBoost);
    }

    const newFilter = (state.filter.alarm === 1);
    await this.setCapabilityValue('alarm_filter', newFilter);
    if (oldFilter !== null && oldFilter !== newFilter) {
      await this.triggerFilterAlarm(newFilter);
    }

    await this.setCapabilityValue('filter_timer', `${state.filter.timer.days}:${state.filter.timer.hour}:${state.filter.timer.min}`);

    const newGeneric = (state.alarm !== 0);
    await this.setCapabilityValue('alarm_generic', newGeneric);
    if (oldGeneric !== null && oldGeneric !== newGeneric) {
      await this.triggerGenericAlarm(newGeneric);
    }

    await this.setCapabilityValue('measure_humidity', state.humidity.current);
    await this.setCapabilityValue('measure_RPM', state.fan.rpm1);

    // Speed and modes
    await this.setCapabilityValue('breezy_speed_mode', state.speed.mode.toString());
    // Manual speed: Breezy uses 10-100% directly (not 0-255 like Expert)
    await this.setCapabilityValue('manualSpeed', state.speed.manualspeed);
    await this.setCapabilityValue('fan_speed', state.speed.manualspeed / 100);
    await this.setCapabilityValue('breezy_operation_mode', state.operationmode.toString());
    await this.setCapabilityValue('breezy_timer_mode', state.timers.mode.toString());
    await this.setCapabilityValue('timerMode_timer', `${state.timers.countdown.hour}:${state.timers.countdown.min}:${state.timers.countdown.sec}`);

    // Update settings
    await this.setSettings({
      devicemodel: state.unittype,
      humidity_sensor: (state.humidity.sensoractivation === 1),
      humidity_threshold: state.humidity.threshold,
      co2_sensor: (state.co2sensor === 1),
    });
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('HRV Wi-Fi device has been added');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('devicepwd')) {
      this.devicepwd = newSettings.devicepwd;
      await this.updateDeviceState();
    }
    if (changedKeys.includes('last_known_ip')) {
      this.setStoreValue('lastKnownIP', newSettings.last_known_ip);
    }
    if (changedKeys.includes('humidity_sensor')) {
      await this.driver.setHumiditySensor(this.deviceObject, this.devicepwd, newSettings.humidity_sensor ? 1 : 0);
    }
    if (changedKeys.includes('humidity_threshold')) {
      await this.driver.setHumidityThreshold(this.deviceObject, this.devicepwd, newSettings.humidity_threshold);
    }
    if (changedKeys.includes('co2_sensor')) {
      await this.driver.setCo2Sensor(this.deviceObject, this.devicepwd, newSettings.co2_sensor ? 1 : 0);
    }
  }

  async onCapabilityOnoff(value, opts) {
    try {
      await this.driver.setOnoffStatus(this.deviceObject, this.devicepwd, value ? 1 : 0);
    } catch (error) {
      this.log(`Error setting onoff: ${error.message}`);
      throw error;
    }
  }

  async onCapabilitySpeedMode(value, opts) {
    try {
      await this.driver.setSpeedMode(this.deviceObject, this.devicepwd, value);
    } catch (error) {
      this.log(`Error setting speed mode: ${error.message}`);
      throw error;
    }
  }

  async onCapabilityManualSpeed(value, opts) {
    try {
      // Breezy uses 10-100% directly
      await this.driver.setManualSpeed(this.deviceObject, this.devicepwd, value);
    } catch (error) {
      this.log(`Error setting manual speed: ${error.message}`);
      throw error;
    }
  }

  async onCapabilityFanSpeed(value, opts) {
    try {
      // fan_speed is 0-1, convert to 10-100%
      const speedPercent = Math.round(10 + (value * 90));
      await this.driver.setManualSpeed(this.deviceObject, this.devicepwd, speedPercent);
    } catch (error) {
      this.log(`Error setting fan speed: ${error.message}`);
      throw error;
    }
  }

  async onCapabilityOperationMode(value, opts) {
    try {
      await this.driver.setOperationMode(this.deviceObject, this.devicepwd, value);
    } catch (error) {
      this.log(`Error setting operation mode: ${error.message}`);
      throw error;
    }
  }

  async onCapabilityTimerMode(value, opts) {
    try {
      await this.driver.setTimerMode(this.deviceObject, this.devicepwd, value);
    } catch (error) {
      this.log(`Error setting timer mode: ${error.message}`);
      throw error;
    }
  }

  async onCapabilityResetFilter(value, opts) {
    try {
      this.log('Resetting filter timer');
      await this.driver.resetFilterTimer(this.deviceObject, this.devicepwd);
      await this.setCapabilityValue('alarm_filter', false);
      await this.updateDeviceState();
    } catch (error) {
      this.log(`Error resetting filter: ${error.message}`);
      throw error;
    }
  }

  async setupFlowSpeedMode() {
    this.log('Setting up HRV speed mode flow card');
    this._flowSpeedMode = await this.homey.flow.getActionCard('hrv_speed_mode');
    this._flowSpeedMode.registerRunListener(async (args, state) => {
      this.log(`Setting speed mode to: ${args.speedMode}`);
      await this.setCapabilityValue('breezy_speed_mode', args.speedMode);
      await this.driver.setSpeedMode(args.device.deviceObject, args.device.devicepwd, args.speedMode);
    });
  }

  async setupFlowOperationMode() {
    this.log('Setting up HRV operation mode flow card');
    this._flowOperationMode = await this.homey.flow.getActionCard('hrv_operation_mode');
    this._flowOperationMode.registerRunListener(async (args, state) => {
      this.log(`Setting operation mode to: ${args.operationMode}`);
      await this.setCapabilityValue('breezy_operation_mode', args.operationMode);
      await this.driver.setOperationMode(args.device.deviceObject, args.device.devicepwd, args.operationMode);
    });
  }

  async setupFlowTimerMode() {
    this.log('Setting up HRV timer mode flow card');
    this._flowTimerMode = await this.homey.flow.getActionCard('hrv_timer_mode');
    this._flowTimerMode.registerRunListener(async (args, state) => {
      this.log(`Setting timer mode to: ${args.timerMode}`);
      await this.setCapabilityValue('breezy_timer_mode', args.timerMode);
      await this.driver.setTimerMode(args.device.deviceObject, args.device.devicepwd, args.timerMode);
    });
  }

  async setupFlowManualSpeed() {
    this.log('Setting up HRV manual speed flow card');
    this._flowManualSpeed = await this.homey.flow.getActionCard('hrv_manual_speed');
    this._flowManualSpeed.registerRunListener(async (args, state) => {
      this.log(`Setting manual speed to: ${args.speed}%`);
      await this.setCapabilityValue('manualSpeed', args.speed);
      await this.setCapabilityValue('fan_speed', args.speed / 100);
      await this.driver.setManualSpeed(args.device.deviceObject, args.device.devicepwd, args.speed);
    });
  }

  async setupFlowResetFilter() {
    this.log('Setting up HRV reset filter flow card');
    this._flowResetFilter = await this.homey.flow.getActionCard('hrv_reset_filter');
    this._flowResetFilter.registerRunListener(async (args, state) => {
      this.log('Flow action: resetting filter timer');
      await args.device.driver.resetFilterTimer(args.device.deviceObject, args.device.devicepwd);
      await args.device.setCapabilityValue('alarm_filter', false);
      await args.device.updateDeviceState();
    });
  }

  async triggerBoostAlarm(isOn) {
    const triggerCard = isOn ? 'hrv_alarm_boost_true' : 'hrv_alarm_boost_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow.getDeviceTriggerCard(triggerCard).trigger(this, {}, {});
  }

  async triggerFilterAlarm(isOn) {
    const triggerCard = isOn ? 'hrv_alarm_filter_true' : 'hrv_alarm_filter_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow.getDeviceTriggerCard(triggerCard).trigger(this, {}, {});
  }

  async triggerGenericAlarm(isOn) {
    const triggerCard = isOn ? 'hrv_alarm_generic_true' : 'hrv_alarm_generic_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow.getDeviceTriggerCard(triggerCard).trigger(this, {}, {});
  }

}

module.exports = HrvWifiDevice;
