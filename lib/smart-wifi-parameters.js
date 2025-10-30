'use strict';

/**
 * Smart Wi-Fi Parameter mappings
 * Based on b168_1en_01preview.pdf specification
 *
 * These parameters are different from Vento Expert (b133) devices.
 * The blaubergventojs library uses Vento Expert mappings, so we define
 * Smart Wi-Fi specific parameters here as raw hex values.
 */

const SmartWiFiParameter = {
  // Basic control
  FAN_ONOFF: 0x01, // R/W/RW: 0=Off, 1=On, 2=Invert
  BATTERY_STATUS: 0x02, // R: 0=discharged, 1=normal
  MODE_24H: 0x03, // R/W/RW: 0=Off, 1=On, 2=Invert
  CURRENT_RPM: 0x04, // R: 0-6000 RPM (2 bytes)
  BOOST_MODE: 0x05, // R/W/RW: 0=Off, 1=On, 2=Invert
  BOOST_TIMER_COUNTDOWN: 0x06, // R: 0-86400 seconds (3 bytes)

  // Sensor status (read-only)
  STATUS_BUILTIN_TIMER: 0x07, // R: 0=Off, 1=On
  STATUS_HUMIDITY_SENSOR: 0x08, // R: 0=Off, 1=On
  STATUS_TEMP_SENSOR: 0x0a, // R: 0=Off, 1=On
  STATUS_MOTION_SENSOR: 0x0b, // R: 0=Off, 1=On
  STATUS_EXTERNAL_SWITCH: 0x0c, // R: 0=Off, 1=On
  STATUS_INTERVAL_MODE: 0x0d, // R: 0=Off, 1=On
  STATUS_SILENT_MODE: 0x0e, // R: 0=Off, 1=On

  // Sensor permissions
  HUMIDITY_SENSOR_PERMISSION: 0x0f, // R/W/RW: 0=Off, 1=Auto, 2=Manual
  TEMP_SENSOR_PERMISSION: 0x11, // R/W/RW: 0=Off, 1=On, 2=Invert
  MOTION_SENSOR_PERMISSION: 0x12, // R/W/RW: 0=Off, 1=On, 2=Invert
  EXTERNAL_SWITCH_PERMISSION: 0x13, // R/W/RW: 0=Off, 1=On, 2=Invert

  // Speed setpoints
  MAX_SPEED_SETPOINT: 0x18, // R/W/RW/INC/DEC: 30-100%
  SILENT_SPEED_SETPOINT: 0x1a, // R/W/RW/INC/DEC: 30-100%
  INTERVAL_SPEED_SETPOINT: 0x1b, // R/W/RW/INC/DEC: 30-100%

  // Mode settings
  INTERVAL_MODE_ACTIVATION: 0x1d, // R/W/RW: 0=Off, 1=On, 2=Invert
  SILENT_MODE_ACTIVATION: 0x1e, // R/W/RW: 0=Off, 1=On, 2=Invert
  SILENT_MODE_START_TIME: 0x1f, // R/W/RW: 0-86400 seconds (3 bytes)
  SILENT_MODE_END_TIME: 0x20, // R/W/RW: 0-86400 seconds (3 bytes)
  CURRENT_TIME: 0x21, // R/W/RW: 0-86400 seconds (3 bytes)

  // Timer settings
  TURNOFF_DELAY_TIMER: 0x23, // R/W/RW/INC/DEC: 0=Off, 2=5min, 3=15min, 4=30min, 6=60min
  TURNON_DELAY_TIMER: 0x24, // R/W/RW/INC/DEC: 0=Off, 1=2min, 2=5min
  FACTORY_RESET: 0x25, // W: Any byte

  // Network and system
  DEVICE_SEARCH: 0x7c, // R: Device ID (16 chars)
  FIRMWARE_VERSION: 0x86, // R: 6 bytes (major, minor, day, month, year)

  // WiFi settings
  WIFI_MODE: 0x94, // R/W/RW: 1=Client, 2=Access Point
  WIFI_NAME: 0x95, // R/W/RW: Text 1-32
  WIFI_PASSWORD: 0x96, // R/W/RW: Text 8-64
  WIFI_ENCRYPTION: 0x99, // R/W/RW: 48=OPEN, 50=WPA_PSK, 51=WPA2_PSK, 52=WPA_WPA2_PSK
  WIFI_CHANNEL: 0x9a, // R/W/RW: 1-13
  WIFI_DHCP: 0x9b, // R/W/RW: 0=Static, 1=DHCP, 2=Invert
  IP_ADDRESS: 0x9c, // R/W/RW: 4 bytes
  SUBNET_MASK: 0x9d, // R/W/RW: 4 bytes
  GATEWAY: 0x9e, // R/W/RW: 4 bytes
  WIFI_APPLY_SETTINGS: 0xa0, // W: Any byte
  CURRENT_IP_ADDRESS: 0xa3, // R: 4 bytes

  // Device info
  UNIT_TYPE: 0xb9, // R: 2 bytes
};

/**
 * Parameter size information (in bytes)
 * Used to construct packets with correct data sizes
 */
const SmartWiFiParameterSizes = {
  [SmartWiFiParameter.FAN_ONOFF]: 1,
  [SmartWiFiParameter.BATTERY_STATUS]: 1,
  [SmartWiFiParameter.MODE_24H]: 1,
  [SmartWiFiParameter.CURRENT_RPM]: 2,
  [SmartWiFiParameter.BOOST_MODE]: 1,
  [SmartWiFiParameter.BOOST_TIMER_COUNTDOWN]: 3,
  [SmartWiFiParameter.STATUS_BUILTIN_TIMER]: 1,
  [SmartWiFiParameter.STATUS_HUMIDITY_SENSOR]: 1,
  [SmartWiFiParameter.STATUS_TEMP_SENSOR]: 1,
  [SmartWiFiParameter.STATUS_MOTION_SENSOR]: 1,
  [SmartWiFiParameter.STATUS_EXTERNAL_SWITCH]: 1,
  [SmartWiFiParameter.STATUS_INTERVAL_MODE]: 1,
  [SmartWiFiParameter.STATUS_SILENT_MODE]: 1,
  [SmartWiFiParameter.HUMIDITY_SENSOR_PERMISSION]: 1,
  [SmartWiFiParameter.TEMP_SENSOR_PERMISSION]: 1,
  [SmartWiFiParameter.MOTION_SENSOR_PERMISSION]: 1,
  [SmartWiFiParameter.EXTERNAL_SWITCH_PERMISSION]: 1,
  [SmartWiFiParameter.MAX_SPEED_SETPOINT]: 1,
  [SmartWiFiParameter.SILENT_SPEED_SETPOINT]: 1,
  [SmartWiFiParameter.INTERVAL_SPEED_SETPOINT]: 1,
  [SmartWiFiParameter.INTERVAL_MODE_ACTIVATION]: 1,
  [SmartWiFiParameter.SILENT_MODE_ACTIVATION]: 1,
  [SmartWiFiParameter.SILENT_MODE_START_TIME]: 3,
  [SmartWiFiParameter.SILENT_MODE_END_TIME]: 3,
  [SmartWiFiParameter.CURRENT_TIME]: 3,
  [SmartWiFiParameter.TURNOFF_DELAY_TIMER]: 1,
  [SmartWiFiParameter.TURNON_DELAY_TIMER]: 1,
  [SmartWiFiParameter.FACTORY_RESET]: 1,
  [SmartWiFiParameter.DEVICE_SEARCH]: 16,
  [SmartWiFiParameter.FIRMWARE_VERSION]: 6,
  [SmartWiFiParameter.WIFI_MODE]: 1,
  [SmartWiFiParameter.WIFI_NAME]: 0, // Variable
  [SmartWiFiParameter.WIFI_PASSWORD]: 0, // Variable
  [SmartWiFiParameter.WIFI_ENCRYPTION]: 1,
  [SmartWiFiParameter.WIFI_CHANNEL]: 1,
  [SmartWiFiParameter.WIFI_DHCP]: 1,
  [SmartWiFiParameter.IP_ADDRESS]: 4,
  [SmartWiFiParameter.SUBNET_MASK]: 4,
  [SmartWiFiParameter.GATEWAY]: 4,
  [SmartWiFiParameter.WIFI_APPLY_SETTINGS]: 1,
  [SmartWiFiParameter.CURRENT_IP_ADDRESS]: 4,
  [SmartWiFiParameter.UNIT_TYPE]: 2,
};

module.exports = {
  SmartWiFiParameter,
  SmartWiFiParameterSizes,
};
