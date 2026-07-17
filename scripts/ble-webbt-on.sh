#!/usr/bin/env bash
#
# Put the Bluetooth controller into LE-only mode so Web Bluetooth (Chrome on
# Linux) can reach dual-mode ELM327 clones.
#
# Why: the "OBDII" adapter advertises without the "BR/EDR Not Supported" flag,
# so BlueZ (<= 5.72) treats it as dual-mode and always tries the Bluetooth
# Classic bearer first -> the GATT/BLE side is never reached and Chrome reports
# "No compatible ELM327 BLE service found". Disabling BR/EDR forces LE.
#
# Trade-off: while this is active, Bluetooth Classic devices (e.g. JBL speakers,
# most headsets) will NOT connect. Run ./ble-webbt-off.sh to restore them.
#
# Usage: ./scripts/ble-webbt-on.sh   (re-runs itself with sudo if needed)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

echo "Switching Bluetooth controller to LE-only (BR/EDR off)…"
btmgmt power off
btmgmt bredr off
btmgmt power on

# Give BlueZ a moment to bring the controller back up.
for _ in {1..10}; do
  if btmgmt info 2>/dev/null | grep -q 'current settings.*powered'; then
    break
  fi
  sleep 0.3
done

echo
echo "Done — controller is LE-only."
echo "  • Reload the OBD-II Monitor tab and connect to \"OBDII\"."
echo "  • Keep the GNOME Settings › Bluetooth panel CLOSED while connecting."
echo "  • Run ./scripts/ble-webbt-off.sh to restore Classic devices."
