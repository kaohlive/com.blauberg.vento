# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Unofficial Homey app for controlling Blauberg ventilation fans via local LAN using MODBUS protocol. Supports two device families with **automatic device type detection during pairing**:

1. **Vento Expert** (A30/A50/A85/A100 W V.2) - Heat recovery ventilation units
   - Device type identifier: Parameter 0x00B9 returns 3, 4, or 5
2. **Smart Wi-Fi** - Battery-powered smart fans with Wi-Fi connectivity
   - Device type identifier: Parameter 0x00B9 returns values other than 3, 4, or 5

Uses the `blaubergventojs` library for device communication (UDP packet building), with custom parameter mappings for different device types.

### Compatible Brands

Also supports white-label/OEM devices using the same MODBUS protocol:
- **Flexit** ventilation devices
- Other rebranded Blauberg devices

The app automatically detects device type during pairing and assigns the correct driver.

## Build and Development Commands

- **Build**: `npm run build` - Compiles TypeScript to JavaScript (output: `.homeybuild/`)
- **Lint**: `npm run lint` - Runs ESLint on `.js` and `.ts` files
- **Test**: `npm test` - Runs the `node:test` suite in `test/` (fake UDP device on 127.0.0.1; needs Node 18+). `test/`, `tools/` and `resources/` are kept out of the app package (`.homeyignore`, `tsconfig.json` exclude)

## Architecture

### Homey App Structure

This is a Homey SDK v3 app. The actual `app.json` is generated from `.homeycompose/` files - **never edit `app.json` directly**.

Configuration is split across:
- `.homeycompose/app.json` - base app configuration
- `.homeycompose/capabilities/` - custom capability definitions
- `drivers/vento-expert/driver.compose.json` - driver configuration
- `drivers/vento-expert/driver.flow.compose.json` - flow card definitions (triggers, conditions, actions)
- `drivers/vento-expert/driver.settings.compose.json` - driver settings configuration

### Key Components

**App Entry Point** ([app.js](app.js))
- `BlaubergVentoApp` class - minimal initialization, logs app startup

**Driver** ([drivers/vento-expert/driver.js](drivers/vento-expert/driver.js))
- `VentoDriver` manages device discovery and MODBUS communication
- Runs discovery loop every 10 seconds (starts after 5-second delay)
- Maintains `deviceList` array of discovered devices
- All device communication goes through driver methods (`setSpeedMode`, `setOperationMode`, etc.)
- Uses `B133Client` ([lib/b133-transport.js](lib/b133-transport.js)) with 1500ms timeout

**Device** ([drivers/vento-expert/device.js](drivers/vento-expert/device.js))
- `VentoDevice` represents individual fan instances
- Registers capability listeners and flow cards during `setupCapabilities()`
- All state changes call driver methods (device doesn't communicate directly with hardware)
- `updateDeviceState()` fetches and syncs all device state from hardware
- Dynamic capability migration in `updateCapabilities()` (adds `fan_speed`, `alarm_connectivity` if missing)

### Discovery & Connection Flow

1. Driver starts discovery loop on init (10s interval)
2. `locateDevices()` calls `modbusClient.findDevices()`
3. New devices added to `deviceList` with their IP addresses
4. Device init calls `discovery(id)` to locate device object from driver's list
5. If device not found, marked unavailable until next discovery
6. Stores last known IP address in settings to handle discovery failures (DHCP resilience)

### Device Type Detection

**Automatic driver selection during pairing:**

Both drivers query parameter **0x00B9 (UNIT_TYPE)** to determine device compatibility:

**Vento Expert Driver** ([drivers/vento-expert/driver.js](drivers/vento-expert/driver.js)):
- `getDeviceType(device, devicepass)` - Queries 0x00B9 and returns unit type value
- `isVentoExpertDevice(unitType)` - Returns true if unitType is 3, 4, or 5
  - Type 3: Vento Expert A50-1/A85-1/A100-1 W V.2
  - Type 4: Vento Expert Duo A30-1 W V.2
  - Type 5: Vento Expert A30 W V.2
- Pairing flow filters devices to show only Vento Expert types

**Smart Wi-Fi Driver** ([drivers/smart-wifi/driver.js](drivers/smart-wifi/driver.js)):
- `getDeviceType(device, devicepass)` - Queries SmartWiFiParameter.UNIT_TYPE (0x00B9)
- `isSmartWiFiDevice(unitType)` - Returns true if unitType is NOT 3, 4, or 5
- Pairing flow filters devices to show only Smart Wi-Fi types

This ensures users cannot accidentally pair a device with the wrong driver, preventing parameter mapping mismatches and ensuring correct capabilities.

### MODBUS Communication Pattern

All communication flows: Device → Driver → `B133Client` → MODBUS packet
- READ operations fetch multiple parameters in single packet (see `getDeviceState()`), retried via `sendWithRetry`
- WRITE operations send single parameter updates via `setDeviceValue()` as WRITEREAD (0x03), so the device confirms; a missing confirmation throws. Write-only (W) parameters such as the filter reset pass `{ confirm: false }` and use WRITE. Writes to one device are queued in order
- `B133Client` never throws from a socket callback: invalid IP, device id or password and socket errors reject the promise. Never call the library's `BlaubergVentoClient` (its socket has no error handler)
- Device password required for all communications (set during pairing)

**Protocol Details** (see `b133_4_1en_01preview.pdf`):
- Protocol: UDP on port 4000, max 256 bytes per packet
- Packet format: `0xFD 0xFD | TYPE | SIZE_ID | ID | SIZE_PWD | PWD | FUNC | DATA | Checksum`
- Function types: READ (0x01), WRITE (0x02), WRITE+RESPONSE (0x03), INC (0x04), DEC (0x05), RESPONSE (0x06)
- Device ID: 16-character hex string (or "DEFAULT_DEVICEID" for broadcast)
- Parameters are 2-byte values (high byte usually 0x00, can be changed with 0xFF command)
- Multi-byte values use little-endian ordering

**Key Parameter Mappings** (from `blaubergventojs` library):
- `Parameter.ON_OFF` (0x01): On/Off state
- `Parameter.SPEED` (0x02): Speed mode (1=Low, 2=Medium, 3=High, 255=Manual)
- `Parameter.BOOT_MODE` (0x06): Boost mode status
- `Parameter.TIMER_MODE` (0x07): Timer mode (0=Off, 1=Night, 2=Party)
- `Parameter.MANUAL_SPEED` (0x44): Manual speed 0-255
- `Parameter.FAN1RPM` (0x4A): Fan 1 RPM (2 bytes)
- `Parameter.FILTER_TIMER` (0x64): Filter countdown (3 bytes: min/hour/days)
- `Parameter.VENTILATION_MODE` (0xB7): Operation mode (0=Ventilation, 1=Heat recovery, 2=Supply)
- `Parameter.UNIT_TYPE` (0xB9): Device model identifier
- `Parameter.CURRENT_HUMIDITY` (0x25): Current humidity percentage
- `Parameter.READ_ALARM` (0x83): Alarm indicator

### Capabilities & Custom Mappings

Custom capabilities defined in `.homeycompose/capabilities/`:
- `speedMode`: enum (Off/Low/Medium/High/Manual)
- `operationMode`: enum (Ventilation/Regeneration/Supply)
- `timerMode`: enum (Off/Night mode/Party mode)
- `manualSpeed`: number 0-100% (internally converted to 0-255)
- `fan_speed`: normalized 0-1 (also converted to 0-255)
- Various alarms: `alarm_boost`, `alarm_filter`, `alarm_generic`, `alarm_connectivity`

### Flow Cards

Flow triggers, conditions, and actions are registered:
- Triggers: alarm state changes, RPM changes
- Conditions: check alarm states
- Actions: set speed/operation/timer modes
- Flow card listeners in device.js (e.g., `setupFlowSpeedMode()`)

## Multi-Device Support Architecture

### Handling Different Register Mappings

The `blaubergventojs` library has hardcoded parameter enums for Vento Expert devices. To support Smart Wi-Fi devices with different register mappings, we use a layered approach:

**Layer 1: Shared Protocol Handling** (from `blaubergventojs`, transport in `lib/b133-transport.js`)
- `B133Client` (own) - UDP communication
- `Packet` - Packet serialization/deserialization
- `FunctionType` - Function codes (READ, WRITE, etc.)
- `DataEntry` - Data entry construction

**Layer 2: Device-Specific Parameters** (custom)
- [lib/smart-wifi-parameters.js](lib/smart-wifi-parameters.js) - Smart Wi-Fi register mappings
- `blaubergventojs` Parameter enum - Vento Expert register mappings

**Layer 3: Device Drivers**
- [drivers/vento-expert/](drivers/vento-expert/) - Uses `Parameter` enum from library
- [drivers/smart-wifi/](drivers/smart-wifi/) - Uses `SmartWiFiParameter` from custom module

**Example:**
```javascript
// Vento Expert uses library enum
const packet = new Packet(id, pwd, FunctionType.READ, [
    DataEntry.of(Parameter.ON_OFF)  // 0x01 = On/Off for Vento Expert
]);

// Smart Wi-Fi uses custom parameter mapping
const { SmartWiFiParameter } = require('../../lib/smart-wifi-parameters');
const packet = new Packet(id, pwd, FunctionType.READ, [
    DataEntry.of(SmartWiFiParameter.FAN_ONOFF)  // 0x01 = Fan On/Off (different meaning)
]);
```

### Key Differences Between Device Types

| Feature | Vento Expert (b133) | Smart Wi-Fi (b168) |
|---------|---------------------|-------------------|
| Parameter 0x01 | ON_OFF state | Fan On/Off |
| Parameter 0x02 | Speed mode enum | Battery status |
| Parameter 0x04 | N/A | Current RPM (read-only) |
| Parameter 0x05 | N/A | Boost mode |
| Parameter 0x06 | Boost mode status | Boost timer countdown |
| Speed control | Mode-based (Low/Med/High) + Manual 0-255 | Direct percentage 30-100% |
| Special features | Filter timer, humidity sensor, operation modes | Battery status, silent mode, interval mode, sensors |

## Important Notes

- TypeScript compilation is configured but codebase is primarily JavaScript
- Device password must be configured via Blauberg Home app before pairing
- Settings sync bidirectionally: device state updates Homey settings on poll
- Timer values formatted as strings: `"days:hours:minutes"` or `"hours:minutes:seconds"`
- When adding new device types with different registers, create a new parameter mapping file in `lib/` and a new driver in `drivers/`
