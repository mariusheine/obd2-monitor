#!/usr/bin/env bash
#
# Restore normal dual-mode Bluetooth (re-enable BR/EDR) after using
# ble-webbt-on.sh. Bluetooth Classic devices (speakers, headsets) work again.
#
# Usage: ./scripts/ble-webbt-off.sh   (re-runs itself with sudo if needed)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

echo "Restoring dual-mode Bluetooth (BR/EDR on)…"
btmgmt power off
btmgmt bredr on
btmgmt power on

for _ in {1..10}; do
  if btmgmt info 2>/dev/null | grep -q 'current settings.*powered'; then
    break
  fi
  sleep 0.3
done

echo
echo "Done — Bluetooth Classic devices can connect again."
