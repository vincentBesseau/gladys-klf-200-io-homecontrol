# KLF200 - io-homecontrol

This is the user documentation of the integration. Gladys re-hosts this file and shows a permanent
**Documentation** link to it in the Configuration screen — it is when configuring that the user
needs it most.

## What you get

Every io-homecontrol® shutter/window already paired to your Velux KLF200 gateway (via the Velux
app or the gateway's own pairing UI) shows up automatically, each with two controllable features:

- **Position** — a 0–100% slider.
- **State** — an open / stop / closed button.

Both are polled every 60 seconds, so a move made outside Gladys (physical remote, Velux app) is
reflected automatically within a minute.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Fill in the KLF200 gateway's **IP address** and **password** (set on the gateway itself).
   Optionally paste its **TLS fingerprint** to pin the certificate.
3. Save: the integration connects to the gateway and the shutters it already knows about appear in
   the **Discovery** tab, ready to be added.

## Known limitation

The KLF200 only accepts a **single connection at a time**. If the gateway was recently used by
another client (the Velux app, another integration…) a connection attempt can be briefly refused —
the integration retries automatically every 30 seconds and needs no manual action.

## Troubleshooting

The integration logs every connection attempt, discovery and command: check the integration logs
from the Gladys UI (or `docker logs` on the host).
