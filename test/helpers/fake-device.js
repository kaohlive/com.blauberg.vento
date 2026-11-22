'use strict';

const dgram = require('dgram');

/**
 * Encode a b133 packet: 0xFD 0xFD | TYPE | SIZE_ID ID | SIZE_PWD PWD | FUNC |
 * DATA | checksum (little-endian sum of TYPE..DATA).
 */
function encodePacket(id, password, func, data) {
  const body = Buffer.concat([
    Buffer.from([0x02, id.length]), Buffer.from(id, 'ascii'),
    Buffer.from([password.length]), Buffer.from(password, 'ascii'),
    Buffer.from([func]), Buffer.from(data),
  ]);
  let sum = 0;
  for (const byte of body) sum += byte;
  return Buffer.concat([Buffer.from([0xFD, 0xFD]), body, Buffer.from([sum & 0xFF, (sum >> 8) & 0xFF])]);
}

/** Decode the parts of a request packet a fake device needs. */
function decodeRequest(msg) {
  let offset = 3;
  const idLength = msg[offset++];
  const id = msg.subarray(offset, offset + idLength).toString('ascii');
  offset += idLength;
  const passwordLength = msg[offset++];
  const password = msg.subarray(offset, offset + passwordLength).toString('ascii');
  offset += passwordLength;
  const func = msg[offset++];
  return {
    id, password, func, data: msg.subarray(offset, msg.length - 2),
  };
}

/**
 * Start a fake b133 device on 127.0.0.1.
 *
 * @param {function} handler (request, rinfo) => response data bytes, or null to stay
 *   silent; may return a promise. `request.id` is echoed in the response
 *   unless the handler sets `request.replyId`.
 * @returns {Promise<{port:number, requests:Array, close:function}>}
 */
async function startFakeDevice(handler) {
  const socket = dgram.createSocket('udp4');
  const requests = [];
  const respond = async (msg, rinfo) => {
    const request = decodeRequest(msg);
    requests.push(request);
    const data = await handler(request, rinfo);
    if (data == null) return;
    const reply = encodePacket(request.replyId || request.id, request.password, 0x06, data);
    socket.send(reply, rinfo.port, rinfo.address);
  };
  socket.on('message', (msg, rinfo) => {
    respond(msg, rinfo).catch(() => {});
  });
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
  return {
    port: socket.address().port,
    requests,
    close: () => new Promise((resolve) => socket.close(resolve)),
  };
}

module.exports = { startFakeDevice, encodePacket, decodeRequest };
