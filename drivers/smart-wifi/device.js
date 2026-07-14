'use strict';

const { Device } = require('homey');
const { safeSetSettings } = require('../../lib/safe-settings');
const { SmartWiFiParameter } = require('../../lib/smart-wifi-parameters');

// Number of consecutive failed polls before the connectivity alarm is raised.
// At a 10s poll interval (each poll itself retried a few times) this means a
// device must be genuinely unreachable for ~30s before being flagged offline,
// which prevents flapping on transient UDP packet loss.
const CONNECTIVITY_FAIL_THRESHOLD = 3;

// Capabilities that depend on a specific device parameter. If the device
// reports that parameter as not supported (e.g. an iFan without a battery),
// the capability is removed so the UI reflects the real feature set.
const CAPABILITY_BY_PARAM = {
  [SmartWiFiParameter.BATTERY_STATUS]: 'alarm_battery',
  [SmartWiFiParameter.BOOST_MODE]: 'alarm_boost',
  [SmartWiFiParameter.CURRENT_RPM]: 'measure_RPM',
  [SmartWiFiParameter.MAX_SPEED_SETPOINT]: 'dim',
};

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
    // Do not re-add a capability we have learned this device does not support.
    const unsupported = new Set(this.getStoreValue('unsupportedParams') || []);
    if (!this.hasCapability('alarm_battery') && !unsupported.has(SmartWiFiParameter.BATTERY_STATUS)) {
      await this.addCapability('alarm_battery');
    }
  }

  // Persist the parameters this device reports as not supported and remove the
  // capabilities that depend on them. Persisting means updateCapabilities() will
  // not re-add them on the next app start.
  async pruneUnsupportedCapabilities(unsupported) {
    if (!unsupported || unsupported.length === 0) return;
    const stored = new Set(this.getStoreValue('unsupportedParams') || []);
    let changed = false;
    for (const param of unsupported) {
      if (!stored.has(param)) {
        stored.add(param);
        changed = true;
      }
      const capability = CAPABILITY_BY_PARAM[param];
      if (capability && this.hasCapability(capability)) {
        this.log(`Removing capability '${capability}': device reports parameter 0x${param.toString(16).padStart(2, '0')} as not supported`);
        // eslint-disable-next-line no-await-in-loop
        await this.removeCapability(capability).catch((e) => this.log(`Could not remove ${capability}: ${e.message}`));
      }
    }
    if (changed) await this.setStoreValue('unsupportedParams', Array.from(stored));
  }

  async setupCapabilities() {
    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
    }
    if (this.hasCapability('alarm_boost')) {
      this.registerCapabilityListener('alarm_boost', this.onCapabilityBoost.bind(this));
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
        this.log(`Discovery failed, attempting to use last known IP: ${lastKnownIP}`);
        this.deviceObject = {
          id,
          ip: lastKnownIP,
        };
        // Test if device responds at this IP
        try {
          this.devicepwd = this.getSetting('devicepwd') || '1111';
          const state = await this.driver.getDeviceState(this.deviceObject, this.devicepwd);
          if (state) {
            await this.setAvailable();
            this.log(`Smart Wi-Fi device reconnected using last known IP: [${lastKnownIP}]`);
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
      this.devicepwd = this.getSetting('devicepwd') || '1111';
      // Store IP address for future fallback
      await this.setStoreValue('lastKnownIP', this.deviceObject.ip);
      await this.setSettings({ last_known_ip: this.deviceObject.ip });
    }
  }

  async updateDeviceState() {
    // Re-entrancy guard: prevent overlapping state updates from racing on the
    // alarm change-detection (read old value -> await -> write new value -> trigger).
    // Overlapping calls would both read the same old value and fire the same flow twice.
    if (this._updatingState) {
      this.log('Skipping state update, a previous update is still in progress');
      return;
    }
    this._updatingState = true;
    try {
      await this._updateDeviceStateInner();
    } finally {
      this._updatingState = false;
    }
  }

  async _updateDeviceStateInner() {
    this.log('Requesting current device state');
    let state;
    try {
      state = await this.driver.getDeviceState(this.deviceObject, this.devicepwd);
    } catch (error) {
      this.log(`Error getting device state: ${error.message}`);
    }

    if (state === undefined || state === null) {
      // Debounce: a single missed poll (lossy UDP) must not flip connectivity.
      // Only raise the alarm after CONNECTIVITY_FAIL_THRESHOLD consecutive misses.
      this._connectivityFailures = (this._connectivityFailures || 0) + 1;
      this.log(`Device poll failed (${this._connectivityFailures}/${CONNECTIVITY_FAIL_THRESHOLD} consecutive)`);
      if (this._connectivityFailures >= CONNECTIVITY_FAIL_THRESHOLD
        && this.getCapabilityValue('alarm_connectivity') !== true) {
        await this.setCapabilityValue('alarm_connectivity', true);
      }
      return;
    }

    if (this._connectivityFailures) {
      this.log(`Device reachable again after ${this._connectivityFailures} failed poll(s)`);
    }
    this._connectivityFailures = 0;
    if (this.getCapabilityValue('alarm_connectivity') !== false) {
      await this.setCapabilityValue('alarm_connectivity', false);
    }
    // Track successful connection time
    await this.setStoreValue('lastSuccessfulConnection', Date.now());

    // Update stored IP if it changed (device might have gotten new DHCP address)
    const currentStoredIP = this.getStoreValue('lastKnownIP');
    if (this.deviceObject && this.deviceObject.ip && currentStoredIP !== this.deviceObject.ip) {
      this.log(`Device IP changed from ${currentStoredIP} to ${this.deviceObject.ip}`);
      await this.setStoreValue('lastKnownIP', this.deviceObject.ip);
      await this.setSettings({ last_known_ip: this.deviceObject.ip });
    }

    this.log(JSON.stringify(state));

    // Store old values to detect changes
    const oldBattery = this.getCapabilityValue('alarm_battery');
    const oldBoost = this.getCapabilityValue('alarm_boost');

    // Remove capabilities the device reports as unsupported before updating.
    await this.pruneUnsupportedCapabilities(state.unsupported);

    // Update capabilities only for values the device actually returned; a
    // device that supports a subset of parameters leaves the rest undefined.
    if (state.onoff !== undefined && this.hasCapability('onoff')) {
      await this.setCapabilityValue('onoff', (state.onoff === 1));
    }

    if (state.battery !== undefined && this.hasCapability('alarm_battery')) {
      const newBattery = (state.battery === 0);
      await this.setCapabilityValue('alarm_battery', newBattery);
      if (oldBattery !== null && oldBattery !== newBattery) {
        await this.triggerBatteryAlarm(newBattery);
      }
    }

    if (state.boost.mode !== undefined && this.hasCapability('alarm_boost')) {
      const newBoost = (state.boost.mode === 1);
      await this.setCapabilityValue('alarm_boost', newBoost);
      if (oldBoost !== null && oldBoost !== newBoost) {
        await this.triggerBoostAlarm(newBoost);
      }
    }

    if (state.fan.rpm !== undefined && this.hasCapability('measure_RPM')) {
      await this.setCapabilityValue('measure_RPM', state.fan.rpm);
    }

    // Update speed as percentage (0-100%)
    if (state.speed.max !== undefined && this.hasCapability('dim')) {
      await this.setCapabilityValue('dim', state.speed.max / 100);
    }

    // Update settings from the values the device actually returned (skip
    // undefined so we never write a misleading default), guarded against the
    // declared ranges so an out-of-range reading cannot throw "Out Of Bounds".
    const settings = {};
    if (state.speed.max !== undefined) settings.max_speed = state.speed.max;
    if (state.speed.silent !== undefined) settings.silent_speed = state.speed.silent;
    if (state.speed.interval !== undefined) settings.interval_speed = state.speed.interval;
    if (state.modes.silent !== undefined) settings.silent_mode = (state.modes.silent === 1);
    if (state.modes.interval !== undefined) settings.interval_mode = (state.modes.interval === 1);
    if (state.sensors.humidity !== undefined) settings.humidity_sensor = (state.sensors.humidity === 1);
    if (state.sensors.temperature !== undefined) settings.temp_sensor = (state.sensors.temperature === 1);
    if (state.sensors.motion !== undefined) settings.motion_sensor = (state.sensors.motion === 1);
    await safeSetSettings(this, settings, {
      max_speed: [30, 100], silent_speed: [30, 100], interval_speed: [30, 100],
    }, (m) => this.log(m));
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
      this.setStoreValue('lastKnownIP', newSettings.last_known_ip);
    }
    if (changedKeys.includes('max_speed')) {
      await this.driver.setMaxSpeed(this.deviceObject, this.devicepwd, newSettings.max_speed);
    }
    if (changedKeys.includes('silent_speed')) {
      await this.driver.setSilentSpeed(this.deviceObject, this.devicepwd, newSettings.silent_speed);
    }
    if (changedKeys.includes('silent_mode')) {
      await this.driver.setSilentMode(this.deviceObject, this.devicepwd, newSettings.silent_mode ? 1 : 0);
    }
    if (changedKeys.includes('interval_mode')) {
      await this.driver.setIntervalMode(this.deviceObject, this.devicepwd, newSettings.interval_mode ? 1 : 0);
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

  async onCapabilityBoost(value, opts) {
    try {
      await this.driver.setBoostMode(this.deviceObject, this.devicepwd, value ? 1 : 0);
    } catch (error) {
      this.log(`Error setting boost mode: ${error.message}`);
      throw error;
    }
  }

  async onCapabilityDim(value, opts) {
    try {
      // Convert 0-1 to 30-100% (device min is 30%)
      const speedPercent = Math.round(30 + (value * 70));
      await this.driver.setMaxSpeed(this.deviceObject, this.devicepwd, speedPercent);
    } catch (error) {
      this.log(`Error setting speed: ${error.message}`);
      throw error;
    }
  }

  async setupFlowBoost() {
    this.log('Setting up boost flow cards');
    // Register condition card
    this.homey.flow.getConditionCard('smartwifi_alarm_boost').registerRunListener((args, state) => {
      return args.device.getCapabilityValue('alarm_boost');
    });

    // Register action card
    this._flowBoostAction = await this.homey.flow.getActionCard('smartwifi_set_boost');
    this._flowBoostAction.registerRunListener(async (args, state) => {
      this.log(`Setting boost mode to: ${args.boost}`);
      await this.setCapabilityValue('alarm_boost', args.boost);
      await this.driver.setBoostMode(args.device.deviceObject, args.device.devicepwd, args.boost ? 1 : 0);
    });
  }

  async setupFlowBattery() {
    this.log('Setting up battery flow cards');
    // Battery alarm triggers are handled in triggerBatteryAlarm()
  }

  async triggerBoostAlarm(isOn) {
    const triggerCard = isOn ? 'smartwifi_alarm_boost_true' : 'smartwifi_alarm_boost_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow.getDeviceTriggerCard(triggerCard).trigger(this, {}, {});
  }

  async triggerBatteryAlarm(isOn) {
    const triggerCard = isOn ? 'smartwifi_alarm_battery_true' : 'smartwifi_alarm_battery_false';
    this.log(`Triggering ${triggerCard}`);
    await this.homey.flow.getDeviceTriggerCard(triggerCard).trigger(this, {}, {});
  }

  async setupFlowSilentMode() {
    this.log('Setting up silent mode flow card');
    this._flowSilentAction = await this.homey.flow.getActionCard('smartwifi_set_silent_mode');
    this._flowSilentAction.registerRunListener(async (args, state) => {
      this.log(`Setting silent mode to: ${args.silent}`);
      await this.driver.setSilentMode(args.device.deviceObject, args.device.devicepwd, args.silent ? 1 : 0);
    });
  }

}

module.exports = SmartWiFiDevice;
