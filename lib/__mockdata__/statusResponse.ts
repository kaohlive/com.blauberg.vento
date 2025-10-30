import { Response, Parameter } from 'blaubergventojs';

const onResponse = { parameter: 1, value: new Uint8Array([1]) };

const dataEntries = [
  { parameter: 2, value: new Uint8Array([1]) },
  { parameter: 68, value: new Uint8Array([179]) },
  { parameter: 6, value: new Uint8Array([0]) },
  { parameter: 102, value: new Uint8Array([30]) },
  { parameter: 183, value: new Uint8Array([2]) },
  { parameter: 136, value: new Uint8Array([0]) },
  { parameter: 100, value: new Uint8Array([34, 20, 31, 0]) },
  { parameter: 37, value: new Uint8Array([45]) },
  { parameter: 15, value: new Uint8Array([1]) },
  { parameter: 25, value: new Uint8Array([70]) },
  { parameter: 185, value: new Uint8Array([4, 0]) },
  { parameter: 74, value: new Uint8Array([236, 4]) },
  { parameter: 7, value: new Uint8Array([0]) },
  { parameter: 131, value: new Uint8Array([0]) },
  { parameter: 11 as Parameter, value: new Uint8Array([0, 0, 0]) },
];

export const statusResponse: Response = {
  // @ts-expect-error: mock data
  packet: {
    _deviceId: 'devId',
    _password: '1234',
    _functionType: 6,
    dataEntries: [onResponse, ...dataEntries],
    _dataEntries: [onResponse, ...dataEntries],
  },
  ip: '127.0.0.1',
};

export const offResponse: Response = {
  // @ts-expect-error: mock data
  packet: {
    _deviceId: 'devId',
    _password: '1234',
    _functionType: 6,
    dataEntries: [{ parameter: 1, value: new Uint8Array([0]) }, ...dataEntries],
    _dataEntries: [
      { parameter: 1, value: new Uint8Array([0]) },
      ...dataEntries,
    ],
  },
  ip: '127.0.0.1',
};
