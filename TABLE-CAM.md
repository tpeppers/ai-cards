# Table Cam — an iPhone watching the table, a game-play string out

One phone on a stand looks down at the middle of a real card table. As
cards hit the table, the host (Steam Deck, laptop — whatever runs
`npm run server`) reads them with the local card detector and builds the
**game-play string**. The phone can record the session (video + audio) at
the same time, to the host, to the phone, or both. Every session gets a
page on the host where the video plays next to the string and tapping a
card jumps to the moment it was played.

Nothing is installed on the phone — it is Safari, like Table Night.
Nothing leaves the local network: the detector is the YOLO model in
`ml/`, running on the host.

## The output: TPS1

```
TPS1.<game>.<hand>~<hand>~...      game: w = Bid Whist, h = Hearts
hand = <plays>[-<seats>]
```

- **plays** — one letter per card in the order it hit the table, in the
  same alphabet as deal URLs (`a-m` hearts, `n-z` spades, `A-M` clubs,
  `N-Z` diamonds, ace→king). This is exactly BWR1's `plays` field, so a
  hand drops into a full BWR1 record once its deal/bids/call are known.
- **seats** — optional, one per play: `0-3` (P1–P4, clockwise) or `x`.
  Read off where the card landed: a card lands in front of its player.

Example: `TPS1.w.aAnN-2301` — A♥ by P3, A♣ by P4, A♠ by P1, A♦ by P2.

A hand ends automatically at 48 plays (Bid Whist) / 52 (Hearts), or when
you tap **New hand**. Fix mistakes with **Edit** on the session page —
timestamps are kept for every card that stays in place.

## Setup on the host (once)

```bash
npm run build            # the server serves the built app
npm run table:cert       # HTTPS certificate (iOS only gives the camera to HTTPS pages)
npm run server           # http :3001 and https :3443
npm run ml:server        # the card detector (port 3002)
```

`npm run table:cert` writes `certs/` (gitignored): a small local CA and a
certificate for this machine's current IPs and hostname. **Re-run it if
the host's IP changes** (e.g. switching from home WiFi to the
`npm run wifi` hotspot — pass the hotspot IP as an argument if it is not
up yet: `npm run table:cert -- 10.42.0.1`).

Open **Analysis › Table Sessions** on the host: it shows a QR code for the
phone.

## On the iPhone

1. Scan the QR → Safari opens `https://<host>:3443/table`.
   Safari warns the certificate is not trusted: **Show Details → visit
   this website**. To get rid of the warning for good: open
   `http://<host>:3001/table-ca.crt`, allow the profile, install it in
   Settings › General › VPN & Device Management, then turn it on in
   Settings › General › About › Certificate Trust Settings.
2. Put the phone on a stand (gooseneck / tripod) looking **down at the
   middle** of the table. Pick **Nearest player to the phone** — the
   yellow P-labels on the preview show which side is which.
3. **Start camera**, then **● Start**. Allow camera (and microphone).
   Detected cards get a green marker; each new play buzzes and shows up
   under the string.
4. **Ignore the table edges** keeps cards in players' hands (near the
   frame edges) from counting. Widen it if held cards get picked up.
5. **■ Stop** when done. With *Keep a copy for this phone* on, **Save
   video to this phone** opens the share sheet → *Save Video* puts it in
   Photos.

Toggles: *Detect plays* (live string), *Record video*, *Record audio*,
*Save video on host* (streamed up every 3 s while recording, so a long
session never sits only in the phone's memory), *Keep a copy for this
phone*.

The screen is kept awake while running (iOS 16.4+). Keep Safari in the
foreground — iOS pauses the camera for background tabs.

## No host at the table? Record now, detect later

Record the game with the iPhone **Camera app** (it lands in Photos). Later,
on the host's network, open Table Cam (plain `http://<host>:3001/table`
is fine for this) → **Upload a video**, or Table Sessions › Import. The
host reads the cards from the video with the same tracker
(`/recognize-video` samples it at 3 frames/sec; change it per session).

If the host cannot open an iPhone video, set the iPhone to
Settings › Camera › Formats › **Most Compatible** (H.264).

## Sharing

- **Copy link / QR** on a session page: anyone on the host's network can
  watch the video with the string.
- **Download session (.json)** + **Download video**, then **Import** on
  another host (a home server, a hosted copy of this app) to publish it
  there. The .json alone is enough to share the string with timestamps.
- Sessions live in `game-mode-storage/table-sessions/<id>/`
  (`session.json` + `video.*`); `TABLE_STORAGE` moves them.

## Play a video

**▶ Play a video** on the Table Cam page:

- **YouTube** — paste any YouTube link (needs internet). Recent links are
  remembered on the phone.
- **CustomCuts** — when the host has a CustomCuts host running, set
  `CUSTOMCUTS_URL=http://<customcuts-host>:8787` and
  `CUSTOMCUTS_TOKEN=<its auth token>` before `npm run server`. The tab
  lists CustomCuts' current queue and plays entries with their cuts
  (skipped segments are jumped over; "only" tags play just the tagged
  seconds). Local CustomCuts media is streamed through this host, so the
  token never reaches the phone.

## How detection decides a card was played

`server/tablePlay.js`. A card counts once it is seen in the play area in
2 of the last 3 sampled frames at ≥ 0.5 confidence; each card is played at
most once per hand, so a trick lying on the table is four plays however
long it stays. Two index corners of one card are averaged to find the card's
centre, which decides the seat. Cards still on the table when a hand ends
are ignored until they are picked up, so the last trick does not leak into
the next hand.

Known limits: cards played face-down or covered by a hand before two
frames see them are missed (use Edit); a pile of tricks in the middle of
the table makes seats unreliable (sweep tricks to the side or away).

## Tests

```bash
npm run test:table     # tracker + session API (fake detector), no ML needed
```
