# Cloud sync to your own Nextcloud

OBD-II Monitor can upload recorded session data to a **folder on your own Nextcloud**, so
several people driving the same van pool their data. Each device enters your Nextcloud
server URL, a username, an **app password**, and a target folder. Once a minute the app
uploads everything recorded during that minute as **one JSON file**, then removes those
samples from the device.

This is a **no-backend** app: uploads go straight from the browser to Nextcloud's WebDAV
endpoint. A browser on a different origin can only do that if Nextcloud sends CORS headers,
which needs a little one-time setup.

> **Why not a public share link?** A browser can't upload to a Nextcloud *public share*
> (`/public.php/dav`) cross-origin — that endpoint sends no CORS headers and, on managed
> Nextcloud (e.g. Hetzner Storage Share), you can't add them at the reverse proxy. The
> **webapppassword** app *can* CORS-enable the authenticated endpoint
> (`/remote.php/dav`), so the app uploads there with a username + app password instead.

---

## 1. Create a dedicated user (recommended)

An app password grants WebDAV access to **all** of that user's files. So don't hand out one
for your main account — create a throwaway user whose only content is the OBD folder:

1. Nextcloud **Admin settings → Users → New user**, e.g. `van-obd`.
2. Give it a small quota if you like. That's it — the app creates the folder itself.

(You *can* use your own account instead, but then anyone with the app password can read all
your Nextcloud files.)

## 2. Create an app password

Log in as that user, then **Settings → Security → Devices & sessions → Create new app
password**. Copy the generated password (looks like `abcde-fghij-klmno-pqrst-uvwxy`). This
is what each device uses — never the login password.

## 3. Install & configure webapppassword

This app makes Nextcloud send CORS headers so a browser web app may use WebDAV.

1. **Admin settings → Apps** → search **“WebAppPassword”** → install & enable.
2. Open its settings page and add the **origin** the PWA is served from to the
   **WebDAV/CalDAV origins** list. The origin is scheme + host + optional port, **no path**:
   - Dev: `http://localhost:5173`
   - Deployed: e.g. `https://obd.example.com`
   - Add each origin your users load the app from. One-level wildcards like
     `https://*.example.com` are supported.
3. (Alternative to the settings page) add to `config/config.php`:
   ```php
   'webapppassword.origins' => ['http://localhost:5173', 'https://obd.example.com'],
   ```

Verify from a shell (should print `access-control-allow-origin: <your origin>`):

```bash
curl -si -X OPTIONS https://YOUR_NEXTCLOUD/remote.php/dav/files/ \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: PROPFIND" \
  -H "Access-Control-Request-Headers: x-requested-with,authorization" | grep -i access-control
```

## 4. Configure each device

In the app: **Settings → Cloud sync**
1. **Server URL** — your Nextcloud base address, e.g. `https://cloud.example.com` (no path).
2. **Username** — `van-obd` (the dedicated user).
3. **App password** — the one from step 2.
4. **Target folder** — e.g. `obd-sessions` (created automatically; sub-folders like
   `van/obd` are fine).
5. **This device's name** — e.g. "Marius' phone" (stored inside each upload).
6. Turn **Sync sessions to Nextcloud** on, then tap **Test connection**. Green means the
   credentials work and the folder is ready. A "blocked" error means the webapppassword
   origin (step 3) doesn't match — the fix is on the server, not the app.

Recording starts automatically whenever the app connects to the adapter, and its data
uploads about once a minute. A file that fails to upload (e.g. no signal in the van) isn't
lost — that data simply rolls into the next minute's file when the connection returns.

---

## File layout in the folder

Each recording gets its **own subfolder**, named from the timestamp the recording started
(plus a short id). Inside it is **one file per minute**, named by the moment it was
uploaded:

```
obd-2026-07-12-14-30-05-<shortId>/
    obd-2026-07-12-14-31-05-123.json
    obd-2026-07-12-14-32-05-411.json
    ...
obd-2026-07-12-16-05-11-<shortId>/
    obd-2026-07-12-16-06-10-002.json
    ...
```

Each minute-file holds that session's samples recorded during the minute, and is
self-describing:

```json
{
  "app": "obd2-monitor",
  "uploadedAt": "2026-07-12T14:31:05.123Z",
  "syncSessionId": "…",
  "device": "Marius' phone",
  "session": {
    "startedAt": "2026-07-12T14:30:05.000Z",
    "endedAt": null,
    "transportKind": "ble",
    "pidIds": [ … ]
  },
  "samples": [ { "ts": "2026-07-12T14:31:05.021Z", "pidId": "std.rpm", "value": 820 }, … ]
}
```

Files are pretty-printed JSON. The `<shortId>` is the first 8 characters of `syncSessionId`,
which is globally unique per recording, so drives from different devices never collide.

> After a file uploads successfully, its samples are **deleted from the device** to free
> space — the cloud copy becomes the source of truth. Each drive still appears in the app's
> history (with its total sample count and a "synced" badge), but local CSV/JSON export of
> an already-synced drive will be empty; rebuild it from the cloud files instead.

### Reassemble a full drive

A recording's minute-files are all in its subfolder — order by `uploadedAt` and concatenate
their `samples`:

```bash
# One recording's subfolder → a single merged JSON
jq -s '
  sort_by(.uploadedAt) |
  { syncSessionId: .[0].syncSessionId,
    session: .[-1].session,
    samples: (map(.samples) | add) }
' "obd-2026-07-12-14-30-05-<shortId>/"*.json > drive.json
```

## Security notes

- The app password is stored in the browser's `localStorage` on each device (plaintext).
  Using a **dedicated user** limits what that credential can reach to just the OBD folder.
- To revoke a device, delete its app password in Nextcloud (Devices & sessions) — the
  device stops syncing on its next attempt.
