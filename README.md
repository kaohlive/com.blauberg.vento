# Blauberg Vento

Unofficial app for Blauberg ventilation devices. This app uses local LAN communication using MODBUS over UDP to control your Blauberg fans.

## Supported Devices

This app supports two types of Blauberg devices with automatic detection during pairing:

### Vento Expert Series
- Vento Expert A30 W V.2
- Vento Expert A50-1 W V.2
- Vento Expert A85-1 W V.2
- Vento Expert A100-1 W V.2
- Vento Expert Duo A30-1 W V.2
- VENTO Style
- VENTO inHOME 100
- VENTO inHOME 160

### Smart Wi-Fi Series
- Smart Wi-Fi fans with battery-powered operation
- Features humidity, temperature, and motion sensors
- Silent mode and interval ventilation support

## Compatible Brands

This app might also work with other brands that use the same OEM platform/white label source, including:
- **Flexit** ventilation devices
- **EcoVent**, **Oxxify**, **TwinFresh**, **Duka**
- Other rebranded Blauberg devices using the same MODBUS protocol

During pairing, the app automatically detects your device type and assigns the correct driver with the appropriate parameter mappings.

## Getting Started

1. Use the Blauberg Home mobile app to set up your device and create a device password
2. Ensure your Blauberg device is connected to your local network
3. Install this Homey app
4. Add your device
5. Enter the device password you created in step 1

## Technical Details

- Protocol: MODBUS over UDP (port 4000)
- Communication: Local network only (no cloud required)
- Discovery: Automatic UDP broadcast discovery
- IP Tracking: Fallback to last known IP if DHCP address changes

## Credits

Special thanks to GitHub user [michaelkrog](https://github.com/michaelkrog) for creating the blaubergventojs module.

