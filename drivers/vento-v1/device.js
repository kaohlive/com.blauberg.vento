'use strict';

const { Device } = require('homey');
const { VentoV1Client } = require('../../lib/vento-v1-client');

const MANUAL_SPEED_MIN = 22;
const MANUAL_SPEED_MAX = 255;
const DEFAULT_MANUAL_SPEED = 128;
const PRESET_SPEEDS = ['Low', 'Medium', 'High'];
const OPERATION_MODES = ['Ventilation', 'Regeneration', 'Supply'];

class VentoV1Device extends Device {

  async onInit() {
    this.client = new VentoV1Client(this.getSetting('ip'));
    this.pending = Promise.resolve();
    this.missedPolls = 0;
    this.registerCapabilityListener('onoff', (on) => this.update((client) => client.setPower(on)));
    this.registerCapabilityListener('speedMode', (mode) => this.update((client) => this.setSpeedMode(client, Number(mode))));
    this.registerCapabilityListener('manualSpeed', (percent) => this.setManualSpeedFraction(percent / 100));
    this.registerCapabilityListener('fan_speed', (fraction) => this.setManualSpeedFraction(fraction));
    this.registerCapabilityListener('operationMode', (mode) => this.update((client) => client.setOperationMode(Number(mode))));
    await this.poll();
    this.pollTimer = this.homey.setInterval(() => this.poll(), 10_000);
  }

  async setSpeedMode(client, mode) {
    if (mode === 0) return client.setPower(false);
    if (mode === 255) {
      const { status } = await client.readStatus();
      return client.setManualSpeed(status.manualSpeed ?? DEFAULT_MANUAL_SPEED);
    }
    return client.setSpeed(mode);
  }

  setManualSpeedFraction(fraction) {
    const speed = Math.max(MANUAL_SPEED_MIN, Math.round(fraction * MANUAL_SPEED_MAX));
    return this.update((client) => client.setManualSpeed(speed));
  }

  onDeleted() {
    this.deleted = true;
    this.homey.clearInterval(this.pollTimer);
  }

  async onSettings({ newSettings, changedKeys }) {
    if (!changedKeys.includes('ip')) return;
    const client = new VentoV1Client(newSettings.ip);
    if (this.driver.getDevices().some((device) => device !== this && device.getSetting('ip') === newSettings.ip)) {
      throw new Error('A Vento Expert V1 is already paired at this address');
    }
    await this.update(async () => {
      const result = await client.readStatus();
      this.client = client;
      return result;
    });
  }

  update(request) {
    const operation = this.pending.then(async () => {
      if (this.deleted) return;
      const { status } = await request(this.client);
      if (this.deleted) return;
      this.logStatusChanges(status);
      await this.setCapabilityValue('onoff', status.on);
      const selectedSpeed = status.speed === 4 ? 255 : status.speed;
      const speedMode = status.on ? selectedSpeed : 0;
      if (speedMode !== undefined) await this.setCapabilityValue('speedMode', String(speedMode));
      if (status.manualSpeed !== undefined) {
        const fraction = status.manualSpeed / MANUAL_SPEED_MAX;
        await this.setCapabilityValue('manualSpeed', Math.round(fraction * 100));
        await this.setCapabilityValue('fan_speed', fraction);
      }
      if (status.operationMode !== undefined) {
        await this.setCapabilityValue('operationMode', String(status.operationMode));
      }
      if (status.humidity !== undefined) await this.setCapabilityValue('measure_humidity', status.humidity);
      if (this.hasCapability('measure_power')) {
        const watts = this.estimatePower(status);
        if (Number.isFinite(watts)) await this.setCapabilityValue('measure_power', watts);
      }
      if (status.alarm !== undefined) await this.setCapabilityValue('alarm_generic', status.alarm);
      if (status.boost !== undefined && this.hasCapability('vento_v1_boost')) {
        await this.setCapabilityValue('vento_v1_boost', status.boost);
      }
      if (status.timerRemaining !== undefined) {
        const seconds = status.timerRemaining;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor(seconds / 60) % 60;
        await this.setCapabilityValue('timerMode_timer', `${hours}:${minutes}:${seconds % 60}`);
      }
      if (status.filterChangeRequired !== undefined) {
        const previous = this.getCapabilityValue('alarm_filter');
        const active = status.filterChangeRequired;
        if (previous !== active) {
          await this.setCapabilityValue('alarm_filter', active);
          if (typeof previous === 'boolean' || active) {
            const card = this.homey.flow.getDeviceTriggerCard(`vento_v1_alarm_filter_${active}`);
            card.trigger(this).catch((error) => this.error(error));
          }
        }
      }
      this.missedPolls = 0;
      await this.setAvailable();
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  estimatePower({ on, speed, manualSpeed }) {
    const {
      power_off: off, power_low: low, power_medium: medium, power_high: high,
    } = this.getSettings();
    if (!on) return off;
    if (speed === 4 && manualSpeed !== undefined) {
      // The protocol gives a speed setting but no power curve for manual operation.
      const fraction = (manualSpeed - MANUAL_SPEED_MIN) / (MANUAL_SPEED_MAX - MANUAL_SPEED_MIN);
      return low + fraction * (high - low);
    }
    return [low, medium, high][speed - 1];
  }

  logStatusChanges({ speed, operationMode }) {
    if (speed !== undefined) {
      const preset = PRESET_SPEEDS[speed - 1];
      if (preset && this.lastSpeed !== undefined && this.lastSpeed !== speed) {
        this.log(`Fan speed changed to ${preset}`);
      }
      this.lastSpeed = speed;
    }
    if (operationMode !== undefined) {
      if (this.lastOperationMode !== undefined && this.lastOperationMode !== operationMode) {
        this.log(`Operation mode changed to ${OPERATION_MODES[operationMode]}`);
      }
      this.lastOperationMode = operationMode;
    }
  }

  async poll() {
    try {
      await this.update((client) => client.readStatus());
    } catch (error) {
      this.error(error);
      this.missedPolls += 1;
      if (!this.deleted && this.missedPolls >= 2) {
        await this.setUnavailable(error.message).catch((availabilityError) => this.error(availabilityError));
      }
    }
  }

}

module.exports = VentoV1Device;
