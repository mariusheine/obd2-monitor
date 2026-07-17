#!/usr/bin/env bash
#
# Revert ble-webbt-on.sh: re-enable Bluetooth Classic (BR/EDR) and restore the
# Bluetooth controller's USB autosuspend to the kernel default. Bluetooth
# Classic devices (speakers, headsets) work again afterwards.
#
# Usage: ./scripts/ble-webbt-off.sh   (re-runs itself with sudo if needed)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

# Restore USB autosuspend for every USB Bluetooth controller to $1 ("auto" =
# kernel default). Mirrors the resolver in ble-webbt-on.sh.
set_bt_usb_autosuspend() {
  local mode="$1" applied=0 hci iface dev
  for hci in /sys/class/bluetooth/hci*; do
    [[ -e "$hci/device" ]] || continue
    iface=$(readlink -f "$hci/device") || continue
    dev=$iface
    while [[ "$dev" != "/" && ! -f "$dev/idVendor" ]]; do
      dev=$(dirname "$dev")
    done
    if [[ -f "$dev/power/control" ]]; then
      echo "$mode" >"$dev/power/control"
      echo "  ${hci##*/}: USB autosuspend -> $mode"
      applied=1
    fi
  done
  [[ $applied -eq 1 ]] || echo "  (no USB Bluetooth controller found — nothing to do)"
}

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

echo "Restoring USB autosuspend to the kernel default…"
set_bt_usb_autosuspend auto

echo
echo "Done — Bluetooth Classic devices can connect again."
