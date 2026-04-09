'use strict';

/**
 * Breezy / HRV Wi-Fi Parameter mappings
 * Based on breezy-manual-21433.pdf specification
 *
 * These devices share the same protocol as Vento Expert but have
 * different capabilities: 5 speed modes, CO2/VOC/temperature sensors,
 * heater control, and 4-byte filter countdown.
 *
 * Compatible devices:
 * - Breezy 160 (unit type 17)
 * - Breezy Eco 160 (unit type 20)
 * - Breezy 200 (unit type 22)
 * - Breezy Eco 200 (unit type 24)
 */

const BreezyParameter = {
  // Basic control
  ON_OFF: 0x01,                         // R/W/RW: 0=Off, 1=On, 2=Invert
  SPEED: 0x02,                          // R/W/RW/INC/DEC: 1-5, 255=manual (see MANUAL_SPEED)
  TIMER_MODE: 0x07,                     // R/W/RW/INC/DEC: 0=Off, 1=Night, 2=Turbo
  TIMER_COUNTDOWN: 0x0B,               // R: seconds/minutes/hours (3 bytes)

  // Sensor permissions
  HUMIDITY_SENSOR_ENABLE: 0x0F,         // R/W/RW: 0=Off, 1=On, 2=Invert
  CO2_SENSOR_ENABLE: 0x11,             // R/W/RW: 0=Off, 1=On, 2=Invert

  // Sensor thresholds
  HUMIDITY_THRESHOLD: 0x19,             // R/W/RW/INC/DEC: 40-80 RH%
  CO2_THRESHOLD: 0x1A,                 // R/W/RW/INC/DEC: 400-2000 ppm (2 bytes)

  // Temperature readings
  TEMP_OUTDOOR: 0x1F,                  // R: signed 2 bytes (/10 for °C)
  TEMP_SUPPLY_AFTER_HEATER: 0x20,      // R: signed 2 bytes (/10 for °C)
  TEMP_EXHAUST_INLET: 0x21,            // R: signed 2 bytes (/10 for °C)
  TEMP_EXHAUST_OUTLET: 0x22,           // R: signed 2 bytes (/10 for °C)

  // Sensor readings
  RTC_BATTERY_VOLTAGE: 0x24,           // R: 0-5000 mV (2 bytes)
  CURRENT_HUMIDITY: 0x25,              // R: 0-100 RH%
  CURRENT_CO2: 0x27,                   // R: 0-2000 ppm (2 bytes)

  // Per-speed fan settings
  SUPPLY_FAN_SPEED_1: 0x3A,            // R/W/RW/INC/DEC: 10-100%
  EXHAUST_FAN_SPEED_1: 0x3B,           // R/W/RW/INC/DEC: 10-100%
  SUPPLY_FAN_SPEED_2: 0x3C,            // R/W/RW/INC/DEC: 10-100%
  EXHAUST_FAN_SPEED_2: 0x3D,           // R/W/RW/INC/DEC: 10-100%
  SUPPLY_FAN_SPEED_3: 0x3E,            // R/W/RW/INC/DEC: 10-100%
  EXHAUST_FAN_SPEED_3: 0x3F,           // R/W/RW/INC/DEC: 10-100%

  // Manual speed
  MANUAL_SPEED: 0x44,                  // R/W/RW/INC/DEC: 10-100%

  // Fan RPM
  FAN1_RPM: 0x4A,                      // R: 0-5000 rpm (2 bytes)
  FAN2_RPM: 0x4B,                      // R: 0-5000 rpm (2 bytes)

  // Filter
  FILTER_TIMER_SETUP: 0x63,            // R/W/RW/INC/DEC: 0, 70-365 days (2 bytes)
  FILTER_TIMER_COUNTDOWN: 0x64,        // R: min/hour/days (4 bytes!)
  FILTER_RESET: 0x65,                  // W: 1=execute

  // Heater
  HEATER_CONTROL: 0x68,                // R/W/RW: 0=Off, 1=On, 2=Invert

  // RTC
  RTC_TIME: 0x6F,                      // R/W/RW: sec/min/hour (3 bytes)
  RTC_CALENDAR: 0x70,                  // R/W/RW: day/weekday/month/year (4 bytes)

  // Schedule
  WEEKLY_SCHEDULE: 0x72,               // R/W/RW: 0=Off, 1=On, 2=Invert
  SCHEDULE_SETUP: 0x77,                // R/W/RW: 6 bytes

  // Network and system
  DEVICE_SEARCH: 0x7C,                 // R: Device ID (16 chars)
  DEVICE_PASSWORD: 0x7D,               // R/W/RW: 0-8 chars
  MACHINE_HOURS: 0x7E,                 // R: min/hour/days (4 bytes)

  // Alarms
  ALARM_LIST: 0x7F,                    // R: code+type pairs (variable)
  RESET_ALARMS: 0x80,                  // W: 1=execute
  HEATER_STATUS: 0x81,                 // R: 0=Off, 1=On
  ALARM_INDICATOR: 0x83,               // R: 0=None, 1=Alarm, 2=Warning
  AIR_QUALITY_STATUS: 0x84,            // R: 5 bytes (RH/CO2/reserved/reserved/VOC)

  // System
  CLOUD_SERVER: 0x85,                  // R/W/RW: 0=Off, 1=On, 2=Invert
  FIRMWARE_VERSION: 0x86,              // R: 6 bytes
  FACTORY_RESET: 0x87,                 // W: 1=execute
  FILTER_STATUS: 0x88,                 // R: 0=Clean, 1=Soiled

  // WiFi settings
  WIFI_MODE: 0x94,                     // R/W/RW/INC/DEC: 1=Client, 2=AP
  WIFI_NAME: 0x95,                     // R/W/RW: Text 1-32
  WIFI_PASSWORD: 0x96,                 // R/W/RW: Text 8-64
  WIFI_ENCRYPTION: 0x99,               // R/W/RW: 48=OPEN, 50=WPA, 51=WPA2, 52=WPA/WPA2
  WIFI_CHANNEL: 0x9A,                  // R/W/RW/INC/DEC: 1-13
  WIFI_DHCP: 0x9B,                     // R/W/RW: 0=Static, 1=DHCP, 2=Invert
  IP_ADDRESS: 0x9C,                    // R/W/RW: 4 bytes
  SUBNET_MASK: 0x9D,                   // R/W/RW: 4 bytes
  GATEWAY: 0x9E,                       // R/W/RW: 4 bytes
  WIFI_APPLY: 0xA0,                    // W: 1=execute
  WIFI_DISCARD: 0xA2,                  // W: 1=execute
  CURRENT_IP: 0xA3,                    // R: 4 bytes

  // Ventilation mode
  VENTILATION_MODE: 0xB7,              // R/W/RW/INC/DEC: 0=Ventilation, 1=Regeneration, 2=Supply, 3=Extract
  UNIT_TYPE: 0xB9,                     // R: 2 bytes

  // Extended parameters (page 0x01)
  RECOVERY_EFFICIENCY: 0x0129,         // R: 0-100%
  RESTORE_FAN_SPEEDS: 0x012A,          // R/W/RW: 1=execute

  // Extended parameters (page 0x03)
  NIGHT_TIMER_SETPOINT: 0x0302,        // R/W/RW: min/hour (2 bytes)
  TURBO_TIMER_SETPOINT: 0x0303,        // R/W/RW: min/hour (2 bytes)
  HUMIDITY_SENSOR_STATUS: 0x0304,      // R: 0=Below, 1=Over setpoint
  SCHEDULE_CURRENT_SPEED: 0x0306,      // R: 0-3
  FROST_PROTECTION: 0x030B,            // R: 0=Inactive, 1=Active
  VOC_SENSOR_ENABLE: 0x0315,           // R/W/RW: 0=Off, 1=On, 2=Invert
  VOC_THRESHOLD: 0x031F,               // R/W/RW/INC/DEC: 50-250 index (2 bytes)
  CURRENT_VOC: 0x0320,                 // R: 0-500 index (2 bytes)
};

/**
 * Parameter size information (in bytes)
 * Used by the parameterSizeResolver to parse response packets
 */
const BreezyParameterSizes = {
  [BreezyParameter.ON_OFF]: 1,
  [BreezyParameter.SPEED]: 1,
  [BreezyParameter.TIMER_MODE]: 1,
  [BreezyParameter.TIMER_COUNTDOWN]: 3,
  [BreezyParameter.HUMIDITY_SENSOR_ENABLE]: 1,
  [BreezyParameter.CO2_SENSOR_ENABLE]: 1,
  [BreezyParameter.HUMIDITY_THRESHOLD]: 1,
  [BreezyParameter.CO2_THRESHOLD]: 2,
  [BreezyParameter.TEMP_OUTDOOR]: 2,
  [BreezyParameter.TEMP_SUPPLY_AFTER_HEATER]: 2,
  [BreezyParameter.TEMP_EXHAUST_INLET]: 2,
  [BreezyParameter.TEMP_EXHAUST_OUTLET]: 2,
  [BreezyParameter.RTC_BATTERY_VOLTAGE]: 2,
  [BreezyParameter.CURRENT_HUMIDITY]: 1,
  [BreezyParameter.CURRENT_CO2]: 2,
  [BreezyParameter.SUPPLY_FAN_SPEED_1]: 1,
  [BreezyParameter.EXHAUST_FAN_SPEED_1]: 1,
  [BreezyParameter.SUPPLY_FAN_SPEED_2]: 1,
  [BreezyParameter.EXHAUST_FAN_SPEED_2]: 1,
  [BreezyParameter.SUPPLY_FAN_SPEED_3]: 1,
  [BreezyParameter.EXHAUST_FAN_SPEED_3]: 1,
  [BreezyParameter.MANUAL_SPEED]: 1,
  [BreezyParameter.FAN1_RPM]: 2,
  [BreezyParameter.FAN2_RPM]: 2,
  [BreezyParameter.FILTER_TIMER_SETUP]: 2,
  [BreezyParameter.FILTER_TIMER_COUNTDOWN]: 4,
  [BreezyParameter.FILTER_RESET]: 1,
  [BreezyParameter.HEATER_CONTROL]: 1,
  [BreezyParameter.RTC_TIME]: 3,
  [BreezyParameter.RTC_CALENDAR]: 4,
  [BreezyParameter.WEEKLY_SCHEDULE]: 1,
  [BreezyParameter.SCHEDULE_SETUP]: 6,
  [BreezyParameter.DEVICE_SEARCH]: 16,
  [BreezyParameter.DEVICE_PASSWORD]: 0, // Variable
  [BreezyParameter.MACHINE_HOURS]: 4,
  [BreezyParameter.ALARM_LIST]: 0, // Variable
  [BreezyParameter.RESET_ALARMS]: 1,
  [BreezyParameter.HEATER_STATUS]: 1,
  [BreezyParameter.ALARM_INDICATOR]: 1,
  [BreezyParameter.AIR_QUALITY_STATUS]: 5,
  [BreezyParameter.CLOUD_SERVER]: 1,
  [BreezyParameter.FIRMWARE_VERSION]: 6,
  [BreezyParameter.FACTORY_RESET]: 1,
  [BreezyParameter.FILTER_STATUS]: 1,
  [BreezyParameter.WIFI_MODE]: 1,
  [BreezyParameter.WIFI_NAME]: 0, // Variable
  [BreezyParameter.WIFI_PASSWORD]: 0, // Variable
  [BreezyParameter.WIFI_ENCRYPTION]: 1,
  [BreezyParameter.WIFI_CHANNEL]: 1,
  [BreezyParameter.WIFI_DHCP]: 1,
  [BreezyParameter.IP_ADDRESS]: 4,
  [BreezyParameter.SUBNET_MASK]: 4,
  [BreezyParameter.GATEWAY]: 4,
  [BreezyParameter.WIFI_APPLY]: 1,
  [BreezyParameter.WIFI_DISCARD]: 1,
  [BreezyParameter.CURRENT_IP]: 4,
  [BreezyParameter.VENTILATION_MODE]: 1,
  [BreezyParameter.UNIT_TYPE]: 2,
  [BreezyParameter.RECOVERY_EFFICIENCY]: 1,
  [BreezyParameter.RESTORE_FAN_SPEEDS]: 1,
  [BreezyParameter.NIGHT_TIMER_SETPOINT]: 2,
  [BreezyParameter.TURBO_TIMER_SETPOINT]: 2,
  [BreezyParameter.HUMIDITY_SENSOR_STATUS]: 1,
  [BreezyParameter.SCHEDULE_CURRENT_SPEED]: 1,
  [BreezyParameter.FROST_PROTECTION]: 1,
  [BreezyParameter.VOC_SENSOR_ENABLE]: 1,
  [BreezyParameter.VOC_THRESHOLD]: 2,
  [BreezyParameter.CURRENT_VOC]: 2,
};

/**
 * Known Breezy/HRV device types (parameter 0xB9)
 */
const BreezyDeviceTypes = [17, 20, 22, 24];

module.exports = {
  BreezyParameter,
  BreezyParameterSizes,
  BreezyDeviceTypes,
};
