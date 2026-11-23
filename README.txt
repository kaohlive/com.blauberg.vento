Unofficial app for Blauberg ventilation devices. This app uses local LAN communication using MODBUS over UDP to control your Blauberg fans.

SUPPORTED DEVICES
-----------------
This app supports two types of Blauberg devices with automatic detection during pairing:

Vento Expert Series:
- Vento Expert A30 W V.2
- Vento Expert A50-1 W V.2
- Vento Expert A85-1 W V.2
- Vento Expert A100-1 W V.2
- Vento Expert Duo A30-1 W V.2

Vento Expert V.1 Series (separate "Vento Expert V1" driver, no device password; the unit has a fixed IP address, so if you change it, update it in the device settings):
- Vento Expert A50-1 W
- Vento Expert Duo A30-1 W
- Flexit Roomie One WiFi V1

Smart Wi-Fi Series:
- Smart Wi-Fi fans with battery-powered operation
- Features humidity, temperature, and motion sensors
- Silent mode and interval ventilation support

COMPATIBLE BRANDS
-----------------
This app might also work with other brands that use the same OEM platform/white label source, including:
- Flexit ventilation devices
- EcoVent, Oxxify, TwinFresh, Duka
- Other rebranded Blauberg devices using the same MODBUS protocol

During pairing, the app automatically detects your device type and assigns the correct driver with the appropriate parameter mappings.

GETTING STARTED
---------------
1. Use the Blauberg Home mobile app to set up your device and create a device password
2. Ensure your Blauberg device is connected to your local network
3. Install this Homey app
4. Add your device
5. Enter the device password you created in step 1

TECHNICAL DETAILS
-----------------
- Protocol: MODBUS over UDP (port 4000)
- Communication: Local network only (no cloud required)
- Discovery: Automatic UDP broadcast discovery
- IP Tracking: Fallback to last known IP if DHCP address changes

CREDITS
-------
Special thanks to GitHub user michaelkrog for creating the blaubergventojs module.

