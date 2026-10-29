# Asterisk Config Review — Replicating to Another Server

Review of `asterisk/custom/pjsip_dynamic.conf` and `asterisk/custom/extensions_dynamic.conf` against the static config that includes them (`asterisk/config/*.conf`), the generator code that produces them (`pjsipAccount()` / `pjsipTrunk()` in `app/src/server.js`), and the app's `.env` files. Goal: know what to copy as-is, what must change per-server, and what gaps exist either way.

## 1. Dynamic files match their generator — no manual drift

`pjsip_dynamic.conf` / `extensions_dynamic.conf` are exactly what `pjsipAccount()` (`server.js:802`) and `pjsipTrunk()` (`server.js:833`) currently emit. Whatever gaps are listed below are baked into the generator template itself, not one-off hand edits.

## 2. Non-default setting you must not forget: AMI port 5039

- `infra/asterisk/config/manager.conf` sets `port=5039`.
- Asterisk's native default AMI port is **5038**, and server.js's own hardcoded fallback (`server.js:973`) is also 5038.
- This only works today because `apps/telephony/.env` explicitly sets `ASTERISK_AMI_PORT=5039` (the app loads its own `.env` from its service WorkingDirectory).

**Action:** on the new server, either (a) copy `manager.conf` as-is and make sure `ASTERISK_AMI_PORT=5039` is set in whichever `.env` the app actually loads, or (b) simplify by changing `manager.conf` back to the standard `5038` and dropping the override. Either is fine — just don't let the port and the env var drift apart.

## 3. Server-specific values — must change, not copy verbatim

| Setting | File | Current value | Notes |
|---|---|---|---|
| `external_media_address` / `external_signaling_address` | `pjsip.conf` (`transport-udp`) | `185.143.197.7` | This server's public IP — set to the new server's own public IP |
| Trunk registration (`server_uri`, `client_uri`, `from_domain`) | `pjsip_dynamic.conf` | `109.235.199.68` | SIP provider's server for this number |
| Trunk auth (`username`, `password`) | `pjsip_dynamic.conf` | `123111067` / `b6c7ef70eab8` | Provider credentials for this number — copy only if reusing the same trunk/number |
| ARI/AMI secrets | `ari.conf`, `manager.conf` | `crmAriSecret2026`, `crmAmiSecret2026` | Fine to reuse, but only matter if they match `ASTERISK_ARI_SECRET` / `ASTERISK_AMI_SECRET` in the new server's `.env` — same drift risk as #2 |

## 4. Security gap present here — don't propagate it

Extension `1001`'s password is literally `change-me-1001` — an unrotated placeholder. Copying it reproduces an open SIP account with a guessable credential. **Set a real strong password per extension on the new server.**

## 5. Native best-practice gaps (exist on this server too — matching won't fix them)

- **`rtp.conf`**: `rtpstart=11000` / `rtpend=11100` — only 100 ports ≈ 50 concurrent RTP streams, much narrower than the commonly recommended 10000–20000 range. If replicating for more capacity, widen the range — and make sure the new server's firewall/security-group opens the exact same UDP range plus port 5060.
- **Extension endpoints** (via `pjsipAccount()`) have no `rtp_symmetric`, `qualify_frequency`, or explicit `dtmf_mode`, unlike the trunk endpoint which has all three. Fine if extensions only ever register from inside `local_net` (10/8, 172.16/12, 192.168/16 — already configured), but if any extension will register from outside that range on the new server (e.g. a remote mobile softphone), expect one-way audio and no dead-registration detection. Consider adding `rtp_symmetric=yes` and an `aor` `qualify_frequency` to the template for that use case.

## 6. Cloud-hosted NAT gotcha — resolved 2026-08-06, must replicate on every new server

This server is a VM on **VMware Cloud Director** (Azintelecom) behind NAT: private IP `172.16.30.x` translated to public `185.143.197.7`. If the new server is *also* behind a cloud NAT/hypervisor edge (Cloud Director, or equivalent on another provider), opening the RTP UDP range in the guest OS's own firewall (`ufw`, §5 above) is **not sufficient** — that only controls the VM's local packet filter, not the hypervisor-level NAT/routing in front of it.

We hit a real outage from exactly this gap: a new SIP trunk had healthy signaling (INVITE/183/200/ACK all fine) but the callee never heard audio, and looked identical to a provider-side failure — the provider even confirmed zero inbound RTP was ever reaching us, which pointed straight at "their problem." It wasn't. The actual cause, found after a plain softphone with the same credentials worked perfectly (which is what should have been tried much earlier to isolate provider vs. our infra):

- The Edge Gateway's only **SNAT** rule was a whole-subnet masquerade (`172.16.30.0/24 → public IP`, all ports) — this dynamically rewrites the *source port* of outbound RTP, so the port Asterisk puts in its own SDP (from the `rtp.conf` range) does not match the port the far end actually sees traffic arrive from.
- There was **no DNAT rule at all** for the RTP UDP port range — only named services (HTTP/SSH/RDP/etc.) had inbound rules — so inbound RTP sent to the SDP-advertised port had nowhere to route to.

**Required on every cloud-NAT'd deployment**, in the provider's NAT/Edge Gateway console (not just guest-OS `ufw`):
1. A **DNAT** rule: public IP, UDP, the exact `rtp.conf` port range (`11000-11100` here) → the VM's private IP, same port range (port-for-port, not remapped).
2. A **SNAT** rule scoped to just this VM (single IP, not the whole subnet) so it gets 1:1 port-preserving translation instead of masquerade/PAT — otherwise the SDP-advertised port and the wire-observed port will keep disagreeing. Can be scoped further to just the SIP provider's IP if you want to avoid changing NAT behavior for the VM's other outbound traffic.

Cloud Director-specific UI note: if using an "Application Port Profile" object to define the port range for the DNAT rule, be aware that **range-based profiles may silently fail to appear in the NAT rule's Application dropdown** even though they save correctly (single-port profiles work fine — this is how the bug was isolated). Workaround: skip the named profile object and enter the raw port range directly in the NAT rule's own port field, if the UI's "Add NAT Rule" form supports it (it did here).

## Bottom line for replication

1. Copy `asterisk/config/*.conf` and `asterisk/custom/*.conf` verbatim as a starting point.
2. Swap the public IP in `transport-udp`.
3. Decide trunk credentials per §3 (same number/provider vs. new one).
4. Make sure whichever `.env` the app loads on the new box carries `ASTERISK_AMI_PORT=5039` (or fix `manager.conf` to `5038` instead).
5. Rotate the `1001` password rather than copying the placeholder.
6. If the new server is behind cloud NAT (Cloud Director or equivalent), configure the DNAT + scoped-SNAT rules per §6 above — don't rely on guest-OS `ufw` alone, and don't assume "provider says nothing's arriving" means it's the provider's fault.
