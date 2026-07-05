'use strict';

/**
 * Apply settings derived from live device readings without letting an
 * out-of-range value crash the poll.
 *
 * Device firmware can report a value outside the range a setting declares in
 * driver.settings.compose.json - e.g. boost_delay = 0 (disabled) when the UI
 * range is 1-60. Homey's setSettings then throws "Out Of Bounds", and because
 * the device is polled every ~10s that single bad reading floods the error log
 * (thousands of identical errors).
 *
 * Numeric values outside their declared [min, max] are dropped so the setting
 * simply keeps its previous value while the remaining settings still sync. The
 * call itself is also wrapped, so any other unexpected rejection is logged
 * rather than thrown up into the poll loop.
 *
 * @param {object} device Homey Device instance (provides setSettings)
 * @param {object} settings key -> value to write
 * @param {object} [ranges] key -> [min, max] for numeric settings to bounds-check
 * @param {function} [log]
 * @returns {Promise<void>}
 */
async function safeSetSettings(device, settings, ranges = {}, log = () => {}) {
  const filtered = {};
  Object.keys(settings).forEach((key) => {
    const value = settings[key];
    const range = ranges[key];
    if (range && typeof value === 'number') {
      const [min, max] = range;
      if (!Number.isFinite(value) || value < min || value > max) {
        log(`Skipping setting '${key}': device value ${value} is outside the allowed range ${min}-${max}`);
        return;
      }
    }
    filtered[key] = value;
  });

  try {
    await device.setSettings(filtered);
  } catch (error) {
    log(`Could not sync device settings: ${error.message}`);
  }
}

module.exports = { safeSetSettings };
