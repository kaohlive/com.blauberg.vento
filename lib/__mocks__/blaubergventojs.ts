export * from 'blaubergventojs';

export const sendMock = jest.fn((packet, ip) =>
  Promise.resolve({ packet, ip })
);

export const findDevicesMock = jest
  .fn()
  .mockResolvedValue([{ id: 'TEST1234', ip: '127.0.0.3' }]);

export class BlaubergVentoClient {
  send = sendMock;
  findDevices = findDevicesMock;
}
