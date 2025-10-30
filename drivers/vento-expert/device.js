'use strict';

const { Device } = require('homey');

class VentoDevice extends Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    const { id } = this.getData();
    this.log(`Locating device with id ${id}`);
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
  }

  async setupCapabilities() {
    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener(
        'onoff',
        this.onCapabilityOnoff.bind(this)
      );
    }
    if (this.hasCapability('speedMode')) {
      this.registerCapabilityListener(
        'speedMode',
        this.onCapabilitySpeedmode.bind(this)
      );
      await this.setupFlowSpeedMode();
    }
    if (this.hasCapability('manualSpeed')) {
      this.registerCapabilityListener(
        'manualSpeed',
        this.onCapabilityManualSpeed.bind(this)
      );
      await this.setupFlowManualSpeed();
    }
    if (this.hasCapability('fan_speed')) {
      this.registerCapabilityListener(
        'fan_speed',
        this.onCapabilityFanSpeed.bind(this)
      );
    }
    if (this.hasCapability('operationMode')) {
      this.registerCapabilityListener(
        'operationMode',
        this.onCapabilityOperationMode.bind(this)
      );
      await this.setupFlowOperationMode();
    }
    if (this.hasCapability('alarm_generic')) {
      this.homey.flow
        .getConditionCard('alarm_generic')
        .registerRunListener((args, state) => {
          return args.device.getCapabilityValue('alarm_generic');
        });
    }
    if (this.hasCapability('alarm_boost')) {
      this.homey.flow
        .getConditionCard('alarm_boost')
        .registerRunListener((args, state) => {
          return args.device.getCapabilityValue('alarm_boost');
        });
    }
    if (this.hasCapability('alarm_filter')) {
      this.homey.flow
        .getConditionCard('alarm_filter')
        .registerRunListener((args, state) => {
          return args.device.getCapabilityValue('alarm_filter');
        });
    }
    if (this.hasCapability('timerMode')) {
      this.registerCapabilityListener(
        'timerMode',
        this.onCapabilityTimerMode.bind(this)
      );
      await this.setupFlowTimerMode();
    }
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
              `Vento device reconnected using last known IP: [${lastKnownIP}]`
            );
            return;
          }
        } catch (error) {
          this.log(`Failed to connect using last known IP: ${error.message}`);
        }
      }
      await this.setUnavailable('Device not discovered yet');
      this.log('Vento device could not be located');
    } else {
      await this.setAvailable();
      this.log(`Vento device has been initialized: [${this.deviceObject.ip}]`);
      this.devicepwd = await this.getSetting('devicepwd');
      // Store IP address for future fallback
      await this.setStoreValue('lastKnownIP', this.deviceObject.ip);
      await this.setSettings({ last_known_ip: this.deviceObject.ip });
    }
  }

  async updateDeviceState() {
    this.log('Requesting the current device state');
    const state = await this.driver
      .getDeviceState(this.deviceObject, this.devicepwd)
      .catch(async (error) => {
        await this.setCapabilityValue('alarm_connectivity', true);
      });
    if (state === undefined) {
      return;
    }
    await this.setCapabilityValue('alarm_connectivity', false);

    // Update stored IP if it changed (device might have gotten new DHCP address)
    const currentStoredIP = this.getStoreValue('lastKnownIP');
    if (this.deviceObject?.ip && currentStoredIP !== this.deviceObject.ip) {
      this.log(
        `Device IP changed from ${currentStoredIP} to ${this.deviceObject.ip}`
      );
      await this.setStoreValue('lastKnownIP', this.deviceObject.ip);
      await this.setSettings({ last_known_ip: this.deviceObject.ip });
    }

    this.log(JSON.stringify(state));

    // Store old values to detect changes
    const oldBoost = this.getCapabilityValue('alarm_boost');
    const oldFilter = this.getCapabilityValue('alarm_filter');
    const oldGeneric = this.getCapabilityValue('alarm_generic');

    // Update capabilities
    await this.setCapabilityValue('onoff', state.onoff === 1);

    const newBoost = state.boost?.mode !== 0;
    await this.setCapabilityValue('alarm_boost', newBoost);
    if (oldBoost !== null && oldBoost !== newBoost) {
      await this.triggerBoostAlarm(newBoost);
    }

    const newFilter = state.filter?.alarm === 1;
    await this.setCapabilityValue('alarm_filter', newFilter);
    if (oldFilter !== null && oldFilter !== newFilter) {
      await this.triggerFilterAlarm(newFilter);
    }

    await this.setCapabilityValue(
      'filter_timer',
      `${state.filter?.timer?.days}:${state.filter?.timer?.hour}:${state.filter?.timer?.min}`
    );

    const newGeneric = state.alarm !== 0;
    await this.setCapabilityValue('alarm_generic', newGeneric);
    if (oldGeneric !== null && oldGeneric !== newGeneric) {
      await this.triggerGenericAlarm(newGeneric);
    }
    await this.setCapabilityValue('measure_humidity', state.humidity?.current);
    await this.setCapabilityValue('measure_RPM', state.fan?.rpm);
    // Now handle the different modes
    await this.setCapabilityValue('speedMode', state.speed?.mode?.toString());
    await this.setCapabilityValue(
      'manualSpeed',
      (state.speed?.manualspeed / 255) * 100
    );
    await this.setCapabilityValue('fan_speed', state.speed?.manualspeed / 255);
    await this.setCapabilityValue(
      'operationMode',
      state.operationmode?.toString()
    );
    await this.setCapabilityValue('timerMode', state.timers?.mode?.toString());
    await this.setCapabilityValue(
      'timerMode_timer',
      `${state.timers.countdown.hour}:${state.timers.countdown.min}:${state.timers.countdown.sec}`
    );

    // Update our settings based on current values in the device
    await this.setSettings({
      // only provide keys for the settings you want to change
      devicemodel: state.unittype,
      humidity_sensor: state.humidity?.sensoractivation === 1,
      humidity_threshold: state.humidity?.threshold,
      boost_delay: state.boost?.deactivationtimer,
    });
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('Vento device has been added');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('devicepwd')) {
      this.devicepwd = newSettings.devicepwd;
      await this.updateDeviceState();
    }
    if (changedKeys.includes('last_known_ip')) {
      await this.setStoreValue('lastKnowIP', newSettings.last_known_ip);
    }
    // For the other settings we probably need to push the new value to the device
    if (changedKeys.includes('humidity_sensor')) {
      await this.driver.setHumiditySensor(
        this.deviceObject,
        this.devicepwd,
        newSettings.humidity_sensor
      );
    }
    if (changedKeys.includes('humidity_threshold')) {
      await this.driver.setHumiditySensorThreshold(
        this.deviceObject,
        this.devicepwd,
        newSettings.humidity_threshold
      );
    }
    if (changedKeys.includes('boost_delay')) {
      await this.driver.setBoostDelay(
        this.deviceObject,
        this.devicepwd,
        newSettings.boost_delay
      );
    }
  }

  async onCapabilityOnoff(value, opts) {
    if (value) {
      await this.driver.setOnoffStatus(this.deviceObject, this.devicepwd, 1);
    } else {
      await this.driver.setOnoffStatus(this.deviceObject, this.devicepwd, 0);
    }
    // this.setCapabilityValue('onoff', value);
  }

  async onCapabilitySpeedmode(value, opts) {
    await this.driver.setSpeedMode(this.deviceObject, this.devicepwd, value);
    // this.setCapabilityValue('speedMode', Number(value));
  }

  async onCapabilityManualSpeed(value, opts) {
    await this.driver.setManualSpeed(
      this.deviceObject,
      this.devicepwd,
      255 * (value / 100)
    );
    // this.setCapabilityValue('operationMode', Number(value));
  }

  async onCapabilityFanSpeed(value, opts) {
    await this.driver.setManualSpeed(
      this.deviceObject,
      this.devicepwd,
      255 * value
    );
  }

  async onCapabilityOperationMode(value, opts) {
    await this.driver.setOperationMode(
      this.deviceObject,
      this.devicepwd,
      value
    );
    // this.setCapabilityValue('operationMode', Number(value));
  }

  async onCapabilityTimerMode(value, opts) {
    await this.driver.setTimerMode(this.deviceObject, this.devicepwd, value);
    // this.setCapabilityValue('operationMode', Number(value));
  }

  async setupFlowOperationMode() {
    this.log('Create the flow for the operation mode capability');
    // Now setup the flow cards
    this._flowOperationMode = await this.homey.flow.getActionCard(
      'operation_mode'
    );
    this._flowOperationMode.registerRunListener(async (args, state) => {
      this.log(`attempt to change operation mode: ${args.operationMode}`);
      await this.setCapabilityValue('operationMode', args.operationMode);
      await this.driver.setOperationMode(
        args.device.deviceObject,
        args.device.devicepwd,
        args.operationMode
      );
    });
  }

  async setupFlowSpeedMode() {
    this.log('Create the flow for the speed mode capability');
    // Now setup the flow cards
    this._flowSpeedMode = await this.homey.flow.getActionCard('speed_mode');
    this._flowSpeedMode.registerRunListener(async (args, state) => {
      this.log(`attempt to change speed mode: ${args.speedMode}`);
      await this.setCapabilityValue('speedMode', args.speedMode);
      await this.driver.setSpeedMode(
        args.device.deviceObject,
        args.device.devicepwd,
        args.speedMode
      );
    });
  }

  async setupFlowManualSpeed() {
    this.log('Create the flow for the manual speed capability');
    // Now setup the flow cards
    this._flowManualSpeed = await this.homey.flow.getActionCard(
      'manualSpeed_set'
    );
    this._flowManualSpeed.registerRunListener(async (args, state) => {
      this.log(`attempt to change manual speed: ${args.speed}`);
      await this.setCapabilityValue('manualSpeed', args.speed);
      await this.setCapabilityValue('fan_speed', args.speed / 100 - 1);
      await this.driver.setManualSpeed(
        args.device.deviceObject,
        args.device.devicepwd,
        255 * (args.speed / 100)
      );
    });
  }

  async setupFlowFanSpeed() {
    this.log('Create the flow for the fan speed capability');
    // Now setup the flow cards
    this._flowFanSpeed.registerRunListener(async (args, state) => {
      this.log(`attempt to change fan speed: ${args.speed}`);
      await this.setCapabilityValue('fan_speed', args.fan_speed - 1);
      await this.setCapabilityValue('manualSpeed', args.fan_speed * 100);
      await this.driver.setManualSpeed(
        args.device.deviceObject,
        args.device.devicepwd,
        255 * (args.speed / 100)
      );
    });
  }

  async setupFlowTimerMode() {
    this.log('Create the flow for the timer mode capability');
    // Now setup the flow cards
    this._flowTimerMode = await this.homey.flow.getActionCard('timer_mode');
    this._flowTimerMode.registerRunListener(async (args, state) => {
      this.log(`attempt to change timer mode: ${args.timerMode}`);
      await this.setCapabilityValue('timerMode', args.timerMode);
      await this.driver.setTimerMode(
        args.device.deviceObject,
        args.device.devicepwd,
        args.timerMode
      );
    });
  }

  async triggerBoostAlarm(isOn) {
    const triggerCard = isOn ? 'alarm_boost_true' : 'alarm_boost_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow
      .getDeviceTriggerCard(triggerCard)
      .trigger(this, {}, {});
  }

  async triggerFilterAlarm(isOn) {
    const triggerCard = isOn ? 'alarm_filter_true' : 'alarm_filter_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow
      .getDeviceTriggerCard(triggerCard)
      .trigger(this, {}, {});
  }

  async triggerGenericAlarm(isOn) {
    const triggerCard = isOn ? 'alarm_generic_true' : 'alarm_generic_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow
      .getDeviceTriggerCard(triggerCard)
      .trigger(this, {}, {});
  }
}

module.exports = VentoDevice;
