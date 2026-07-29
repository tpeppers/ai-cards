# Table Night — 4 iPhones, 4 players, zero installs

The whole thing runs off your laptop. Phones use Safari — nobody installs
anything. One person (you) runs the laptop; the other three just scan a QR
code once and then take one photo per hand.

## Before people arrive (10 minutes, laptop)

1. **Start everything** (two terminals, or use `npm run dev:full`):

   ```
   npm run server        # Express API + serves the app  (port 3001)
   npm run ml:server     # card recognizer               (port 3002)
   ```

   If you haven't built the web app since the last code change:
   `npm run build` first (the Express server serves the `build/` folder —
   phones browse to port **3001** directly; no `npm start` needed).

2. **Turn on Game Mode**: open `http://localhost:3001/settings` and enable
   the Game Mode toggle. (One-time per browser.)

3. **Networking — pick one:**
   - **Home WiFi (easiest)**: laptop and all 4 phones on the same WiFi.
     The Upload page's QR codes automatically encode your laptop's LAN IP.
   - **No internet / away from home**: run the ad-hoc hotspot
     (`npm run wifi`, Linux host) — phones scan the *WiFi QR* first to join
     the laptop's own network, then the page QR.
     Windows: use Mobile Hotspot in Settings, then set
     `HOTSPOT_SSID` / `HOTSPOT_PASSWORD` env vars before `npm run server`
     so the WiFi QR renders.

   ⚠️ **Check the QR's IP before people scan.** The server guesses your
   LAN IP from the first network adapter it finds — on machines with
   WSL/VMs/VPNs it can pick a virtual adapter (e.g. `172.31.x.x`) that
   phones can't reach. The spectator link under the QRs shows the address
   being encoded. If it's wrong, restart with it pinned:
   `GAME_MODE_HOST_URL=http://<your-real-LAN-ip>:3001/upload npm run server`
   (find the real IP with `ipconfig` → your WiFi adapter's IPv4).

4. **Open the host screen**: on the laptop, go to
   `http://localhost:3001/upload`. You'll see:
   - the WiFi QR (if configured) — "Step 1"
   - **four QR codes labeled P1–P4** — one per seat at the table
   - the **Dealer selector** (P1–P4 buttons)
   - the **Rounds history** list (fills up as you play)

## Seating people (2 minutes, once)

Positions are **physical chairs, clockwise**: pick any chair as P1, then
P2, P3, P4 going clockwise. Phones never swap.

Walk each person through (this is the whole walkthrough):

> "Scan the QR with your seat's number. Safari opens a page — that's it,
> you're P3 forever. When it's your turn each hand: fan your 12 cards face
> up on the table, tap **Take Photo with Camera**, snap them, tap
> **Upload**. The page tells you what it saw."

Each phone shows a banner: **"📍 You are P3 — this hand you are: 2nd
bidder"**. The role updates automatically every hand; nobody ever picks
a seat from a menu.

5. **Set the first dealer**: on the laptop host screen, click the dealer's
   position (e.g. P2). After every completed hand the dealer advances
   clockwise automatically — you only set it once (or when correcting).

## Every hand (the loop)

1. Deal like normal. Everyone picks up their 12 cards.
2. Each player, at any point before cards start hitting the table
   (before-the-bid is ideal): fan the hand, **Take Photo → Upload**.
   - Spread the cards so every index corner is visible; straight above,
     good light. The page replies "Detected N cards".
   - **If N ≠ 12**: tap **EDIT**, fix the hand in the card picker
     (add missed cards / remove ghosts), tap accept. Takes ~20 seconds.
   - The big green **ACCEPT / CLEAR** button hides your hand from the
     screen — tap it before putting the phone down.
3. The hand completes automatically the moment all 4 seats have 12 clean
   cards — whether the finishing touch is the 4th photo or the last EDIT
   fix. The server then reconstructs the full deal, archives a zip (all 4
   photos + the hand string + metadata), logs it in **Rounds history**,
   and advances the dealer. If the 4th photo lands while some seat still
   has ≠12 cards, the page lists exactly which seats need fixing — EDIT
   them and it completes on the last fix.
4. Play the hand physically like normal. The laptop screen shows
   "Photos in: X/4" so you can see who forgot.

**Misdeal / gave up mid-capture?** Laptop (or any phone): **New Hand**
button — archives whatever was captured (missing seats become `_`) and
resets for the next deal.

## One-phone option: 4-SNAP TABLE

The Upload page also has a large **4-SNAP TABLE** button for passing one
phone around instead of using four position-locked phones:

1. Start with the dealer, spread the hand, and tap **SNAP THIS HAND**.
   On a secure page the browser captures three nearby video frames and
   combines the most stable YOLO detections. On plain LAN HTTP, use the
   native **TAKE SNAP WITH PHONE CAMERA** fallback.
2. Review the found/expected percentage. Retake or use **EDIT CARDS** until
   the hand has exactly 12 unique cards, then tap **ACCEPT & HIDE**.
3. Pass the blacked-out phone clockwise and repeat for all four players.
   Duplicate cards across snaps are blocked before the table can complete.
4. A 16-card spread is treated as one 12-card hand plus the four-card kitty;
   tap the four kitty cards during review. With no kitty capture, the final
   deal is the standard 48 known letters plus `____`.
5. After the fourth accepted snap, the privacy screen waits for the phone's
   physical lock button and opens the completed `/bidwhist#...` hand while
   the screen is hidden. **PLAY NOW** is the manual fallback.

Browsers cannot lock a phone themselves. Live in-page video also requires
HTTPS (or localhost), so the native camera fallback is intentional for
`http://<LAN-IP>:3001` table-night links.

## What you get out of it

- **Hand strings**: every completed hand appears in Rounds history with a
  **Copy** button (the 52-character deal string) and a **Replay ▶** link
  that opens the hand in the Bid Whist game with the real table's seats
  and bidding order (dealer anchored — faithful replay).
- **Photos**: every hand's 4 original photos + `url.txt` + `metadata.json`
  are zipped under `game-mode-storage/<52-char-url>.zip` on the laptop.
  `game-mode-storage/rounds.json` is the machine-readable session log.

## Troubleshooting at the table

| Symptom | Fix |
|---|---|
| Phone can't open the page | Same WiFi as the laptop? Firewall: allow Node on port 3001 (first run prompts). |
| "ML service unavailable" | Start it: `npm run ml:server` (window must stay open). |
| Detection is bad (few cards) | More light, shoot from directly above, spread the fan wider; then EDIT to fix the rest. |
| Wrong seat/role showing | Host screen → set the Dealer to whoever actually dealt this hand. |
| Someone's phone scanned the wrong P | Banner → "unlock", rescan the right QR. |
| Photo went to the wrong hand (late upload) | New Hand to flush, redo the current hand's photos. |

## iOS app (optional, not needed tomorrow)

`ios/` contains a native capture app, freshly updated to the current API
(configurable server address, position picker, role display). It requires
a **Mac with Xcode to build and install** — free personal-team signing
works for 4 phones but each must be plugged in once and re-signed weekly.
See `ios/README.md` for the exact steps. The Safari flow above is
feature-equivalent, which is why it's the plan for game night.
