import VentoDevice from '../drivers/vento-expert/device';
import { Device } from './__mocks__/homey';
import VentoDriver from '../drivers/vento-expert/driver';
import { statusResponse, offResponse } from './__mockdata__/statusResponse';

async function getDevice() {
  const device = new VentoDevice();
  device.driver = new VentoDriver();
  await device.driver.onInit();
  // @ts-expect-error: mock
  (device.driver?.modbusClient?.send as jest.Mock).mockResolvedValue(
    statusResponse
  );
  // @ts-expect-error: mock
  device.driver.deviceList = [{ id: 'TEST1234', ip: '127.0.0.2' }];
  device.driver.getDevices = () => [device];
  return device;
}

describe('ventoDevice', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be able to get status from modbus on init', async () => {
    const device = await getDevice();
    await device.onInit();
    await device.updateDeviceState();

    expect({
      apiCalls: (device as unknown as Device).getMockCalls(),
    }).toMatchSnapshot();
  });
  it('should be able to get status when device is marked as off', async () => {
    const device = await getDevice();
    // @ts-expect-error: mock
    (device.driver?.modbusClient?.send as jest.Mock).mockResolvedValue(
      offResponse
    );
    await device.onInit();
    await device.updateDeviceState();

    expect({
      apiCalls: (device as unknown as Device).getMockCalls(),
    }).toMatchSnapshot();
  });
  it('should be able to handle errors', async () => {
    const device = await getDevice();
    jest
      // @ts-expect-error: ok
      .spyOn(device.driver, 'getDeviceState')
      // @ts-expect-error: ok
      .mockRejectedValue(new Error('test errors'));

    await device.onInit();
    await device.updateDeviceState();

    expect({
      apiCalls: (device as unknown as Device).getMockCalls(),
    }).toMatchSnapshot();
  });

  it('should get and set values trough the api and modbus', async () => {
    const device = await getDevice();
    await device.onInit();
    // @ts-expect-error: call manually
    await device.driver.locateDevices();

    expect({
      // @ts-expect-error: mock
      modbusCalls: (device.driver.modbusClient.send as jest.Mock).mock.calls,
    }).toMatchSnapshot();
  });

  it('should be able to setup all capabilities', async () => {
    const device = await getDevice();
    await device.setupCapabilities();

    expect({
      calls: (device as unknown as Device).getMockCalls(),
    }).toMatchSnapshot();
  });
});
