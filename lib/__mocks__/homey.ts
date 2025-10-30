// eslint-disable-next-line max-classes-per-file
import { callsWithArgs, callCount } from '../testTools';

const setCapabilityValueMock = jest.fn();
const hasCapabilityMock = jest.fn().mockReturnValue(true);
const registerCapabilityListenerMock = jest.fn().mockReturnValue(true);
const registerRunListenerMock = jest.fn();
const getCapabilityValueMock = jest.fn();

const logMock = jest.fn();

const capabilities: Record<string, (value: unknown) => Promise<void>> = {};
const capabilityValue: Record<string, unknown> = {};

class FlowCard {
  capability: string;
  device: unknown;

  constructor(capability: string, device: unknown) {
    this.capability = capability;
    this.device = device;
  }

  registerRunListener = (fn: (value: unknown) => Promise<void>) => {
    capabilities[this.capability] = fn;
    registerRunListenerMock(this.capability, fn);
    return Promise.resolve({
      device: this.device,
      capability: this.capability,
      [this.capability]: capabilityValue[this.capability],
    });
  };

  trigger = (...args: object[]) => {
    logMock('triggered', this.capability, args);
    return Promise.resolve(true);
  };
}

// eslint-disable-next-line import/prefer-default-export
export class Device {
  homey = {
    flow: {
      getActionCard: (capability: string) => new FlowCard(capability, this),
      getConditionCard: (capability: string) => new FlowCard(capability, this),
      getDeviceTriggerCard: (capability: string) =>
        new FlowCard(capability, this),
    },
    setInterval: jest.fn(),
    setTimeout: jest.fn(),
  };

  settings: Record<string, unknown> = {
    devicepwd: 'password',
  };

  store: Record<string, unknown> = {};

  log = (...args: unknown[]) => logMock('log', ...args);
  error = (...args: unknown[]) => logMock('error', ...args);

  getData() {
    return { id: 'TEST1234' };
  }

  async setCapabilityValue(capabilityId: string, value: unknown) {
    const fn = capabilities[capabilityId];
    capabilityValue[capabilityId] = value;
    if (fn) {
      const result = await fn({ value, device: this });
      return setCapabilityValueMock(capabilityId, value, { result });
    }
    return setCapabilityValueMock(
      capabilityId,
      value,
      'calling unregistered capability'
    );
  }

  getCapabilityValue(capabilityId: string) {
    getCapabilityValueMock(capabilityId);
    return capabilityValue[capabilityId];
  }

  async hasCapability(capabilityId: string) {
    hasCapabilityMock(capabilityId);
    return !!capabilities[capabilityId];
  }

  async setStoreValue(key: string, value: unknown) {
    this.store[key] = value;
  }

  async getStoreValue(key: string) {
    return this.store[key];
  }

  async registerCapabilityListener(
    rId: string,
    callback: (value: unknown) => Promise<void>
  ) {
    capabilities[rId] = callback;
    return registerCapabilityListenerMock(rId, callback);
  }

  getSetting(key: string) {
    return this.settings[key];
  }

  setSettings(settings: object) {
    // eslint-disable-next-line no-return-assign
    return (this.settings = { ...this.settings, ...settings });
  }

  async setUnavailable(reason?: string) {
    logMock('setUnavailable was called', reason);
  }

  async setAvailable(reason?: string) {
    logMock('setAvailable', reason);
  }

  getAvailable() {
    return true;
  }

  getMockCalls = () => ({
    setCapabilityValue: callsWithArgs(setCapabilityValueMock.mock.calls),
    hasCapability: callCount(hasCapabilityMock.mock.calls),
    registerCapabilityListener: callCount(
      registerCapabilityListenerMock.mock.calls
    ),
    registerRunListener: callsWithArgs(registerRunListenerMock.mock.calls),
    getCapabilityValue: callCount(getCapabilityValueMock.mock.calls),
    log: logMock.mock.calls,
    settings: this.settings,
    capabilities,
  });
}

export class Driver {
  homey = {
    flow: {
      getActionCard: (capability: string) => new FlowCard(capability, this),
      getConditionCard: (capability: string) => new FlowCard(capability, this),
      getDeviceTriggerCard: (capability: string) =>
        new FlowCard(capability, this),
    },
    setInterval: jest.fn(),
    setTimeout: jest.fn(),
  };

  log = (...args: unknown[]) => logMock('log', ...args);
  error = (...args: unknown[]) => logMock('error', ...args);
}
