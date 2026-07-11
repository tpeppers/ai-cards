# Bid Whist Capture (iOS)

A minimal native capture app for Game Mode: photograph your 12-card hand
and upload it to the table's server. Each phone is configured once in
Settings — the server address and the phone's fixed table position
(P1–P4). The seat role (Dealer / 1st–3rd bidder) rotates server-side
every hand and is shown live in the app.

**You do not need this app for game night.** The Safari flow (scan your
seat's QR on the Upload page) is feature-equivalent with zero installs —
see `TABLE-NIGHT.md` in the repo root. The app exists for people who
prefer a home-screen icon and the native camera flow.

## What it does

- `POST {server}/api/game-mode/upload` with the photo + `pos` (+ optional
  `session`), showing detected cards, photos-in count, and — when the 4th
  photo completes a hand — the 52-char deck string with a Copy button.
- `GET {server}/api/game-mode/table` on launch/after upload for the
  live "this hand you are: …" role display.
- If detection isn't exactly 12 cards, it tells you to fix the seat via
  the Upload page's EDIT flow (or retake).

Project/bundle names still say `HeartsCardCapture` — only display
branding was changed, to avoid risky `project.pbxproj` surgery. Safe to
rename properly in Xcode later (Product → Scheme → Manage Schemes).

## Building (requires a Mac with Xcode)

There is no way to compile or install this from Windows/Linux.

1. `open ios/HeartsCardCapture.xcodeproj` in Xcode (14+).
2. Select the `HeartsCardCapture` target → **Signing & Capabilities** →
   set **Team** to your Apple ID (a free "Personal Team" works).
3. Plug in the iPhone, select it as the run destination, press **Run**.
4. On the phone: Settings → General → VPN & Device Management → trust
   your developer certificate (first install only).
5. Repeat 3–4 for each phone (4 phones ≈ 15 minutes total).

Free personal-team signing notes:
- Apps expire after **7 days** — re-run from Xcode to refresh.
- Max 3 app IDs per free account per week.
- For anything longer-lived you need a paid Apple Developer account and
  TestFlight/ad-hoc distribution.

`npm run build:ios` (repo root) does a CLI `xcodebuild` of the same
project, but installing on devices still requires Xcode or
`xcrun devicectl` on the Mac.

## In-app setup (once per phone)

Gear icon → Settings:
- **Server**: the laptop's LAN address, e.g. `http://192.168.1.42:3001`
  (hotspot mode: `http://10.42.0.1:3001`).
- **Position**: this phone's chair, P1–P4 clockwise around the table.
- Session code: leave blank (single-table default).

Plain-HTTP LAN traffic is allowed via `NSAppTransportSecurity /
NSAllowsArbitraryLoads` in Info.plist — fine for a private game-night
LAN, not something to ship to the App Store as-is.

## Compilation status

The Swift source was modernized on a Windows machine and has NOT been
compiled — smoke-build it in Xcode before relying on it. The web flow is
the verified path.
