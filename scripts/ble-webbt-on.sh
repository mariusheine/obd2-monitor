#!/usr/bin/env bash
#
# Prepare a Linux laptop for Web Bluetooth (Chrome) with a dual-mode ELM327
# clone. Applies the two Linux-only fixes this needs:
#
#   1. LE-only mode (BR/EDR off). The "OBDII" adapter advertises without the
#      "BR/EDR Not Supported" flag, so BlueZ (<= 5.72) treats it as dual-mode and
#      always tries the Bluetooth Classic bearer -> the BLE/GATT side is never
#      reached and Chrome reports "No compatible ELM327 BLE service found".
#
#   2. USB-autosuspend off on the Bluetooth controller. The kernel power-suspends
#      an "idle" USB BT dongle after ~2s; during a live LE link a brief traffic
#      gap lets it suspend, the connection then drops on the supervision timeout
#      and Chrome silently reconnects in a loop. Disabling autosuspend keeps the
#      link rock-stable. (Only affects USB controllers; built-in ones are skipped.)
#
# Neither is needed on Android — this is a desktop-Chrome-on-Linux workaround.
#
# Trade-off: while LE-only is active, Bluetooth Classic devices (JBL speakers,
# headsets) will NOT connect. Run ./ble-webbt-off.sh to restore them; it also
# restores autosuspend to the kernel default.
#
# Usage: ./scripts/ble-webbt-on.sh   (re-runs itself with sudo if needed)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

# Set USB autosuspend for every USB Bluetooth controller. $1 is "on" (never
# autosuspend) or "auto" (kernel default). Resolves the controller's USB device
# via sysfs so it survives re-plugging into a different port; built-in (non-USB)
# controllers have no such node and are skipped.
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
      echo "  ${hci##*/}: USB autosuspend -> $mode  ($(cat "$dev/idVendor"):$(cat "$dev/idProduct"))"
      applied=1
    fi
  done
  [[ $applied -eq 1 ]] || echo "  (no USB Bluetooth controller found — built-in? nothing to do)"
}

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

echo "Disabling USB autosuspend on the Bluetooth controller…"
set_bt_usb_autosuspend on

echo
echo "Done — controller is LE-only and won't USB-autosuspend."
echo "  • Reload the OBD-II Monitor tab and connect to \"OBDII\"."
echo "  • Keep the GNOME Settings › Bluetooth panel CLOSED while connecting."
echo "  • Run ./scripts/ble-webbt-off.sh to restore Classic devices + autosuspend."
