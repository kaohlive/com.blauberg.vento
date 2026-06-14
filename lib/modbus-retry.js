'use strict';

/**
 * Retry helper for the b133 UDP protocol.
 *
 * Communication is over UDP, which is connectionless and lossy - a single
 * dropped request or reply packet on a busy Wi-Fi network makes the library's
 * `send()` resolve to `null` (timeout). Treating that one blip as "device
 * offline" causes the device to flap online/offline between polls. Retrying a
 * read a few times within a single poll absorbs transient packet loss before
 * the caller decides the device is unreachable.
 *
 * `BlaubergVentoClient.send()` resolves to `null` on timeout (it does not
 * reject), so we retry while the result is null and also on thrown errors.
 *
 * @param {object} client BlaubergVentoClient instance
 * @param {object} packet Packet to send
 * @param {string} ip target IP
 * @param {object} [opts]
 * @param {number} [opts.attempts=3] total attempts (>=1)
 * @param {function} [opts.log] logger
 * @returns {Promise<object|null>} the send result, or null if all attempts timed out
 */
async function sendWithRetry(client, packet, ip, { attempts = 3, log = () => {} } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await client.send(packet, ip);
      if (result != null) {
        if (attempt > 1) log(`Reply received from ${ip} on attempt ${attempt}/${attempts}`);
        return result;
      }
      log(`No reply from ${ip} on attempt ${attempt}/${attempts}`);
    } catch (error) {
      lastError = error;
      log(`Send error to ${ip} on attempt ${attempt}/${attempts}: ${error.message}`);
    }
  }
  if (lastError) throw lastError;
  return null;
}

module.exports = { sendWithRetry };
