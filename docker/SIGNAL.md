# Signal announcer setup

Signal has no official bot API. The announcer drives [signal-cli] in JSON-RPC
daemon mode, which needs its own registered phone number — a number that is
**not** already attached to a Signal account you use, because registering takes
it over.

Everything here is optional. With `ANNOUNCE_ADAPTER=noop` (the default) the
server runs normally and posts nothing.

[signal-cli]: https://github.com/AsamK/signal-cli

## 1. Get a number

Use a spare SIM, a VoIP number that can receive SMS, or a second-line service.
It must be able to receive one verification code.

## 2. Register it

Bring the container up and register from inside it. The registration lives in
the `signal-cli-data` volume, so this is a one-time step.

```sh
docker compose --profile signal up -d signal

# Ask Signal for a verification code (add --voice for a phone call instead).
docker compose exec signal signal-cli -a +15551234567 register

# Enter the code you receive.
docker compose exec signal signal-cli -a +15551234567 verify 123-456

# Give the bot a display name.
docker compose exec signal signal-cli -a +15551234567 updateProfile --given-name "Bid Whist Bot"
```

If registration is rejected with a captcha requirement, get a token from
<https://signalcaptchas.org/registration/generate.html> and pass it:

```sh
docker compose exec signal signal-cli -a +15551234567 register --captcha "signalcaptcha://..."
```

## 3. Pick where it posts

**A group** (what you probably want). Have someone add the bot's number to the
group, then list groups to find the id:

```sh
docker compose exec signal signal-cli -a +15551234567 listGroups
```

**Or a single recipient**, handy for testing before a group exists — set
`SIGNAL_RECIPIENT` instead of `SIGNAL_GROUP_ID`.

## 4. Turn it on

In `docker-compose.yml`, set:

```yaml
ANNOUNCE_ADAPTER: signal-cli
SIGNAL_ACCOUNT: "+15551234567"
SIGNAL_GROUP_ID: "the id from listGroups"
```

Then restart the backend:

```sh
docker compose --profile signal up -d --build backend
```

The server logs `Signal announcer: signal-cli` on boot when the adapter is
live. It logs `noop` if the config was incomplete — the server never fails to
start over a misconfigured bot.

## 5. Choose what gets posted

Copy `docker/announce.example.json` to `./game-mode-storage/announce.json`
(the mounted `/data`). Each of the four post types is independently switchable
and can be limited to rooms matching a regex:

| type | when | contains |
|---|---|---|
| `hosting` | host presses the button, once per room | room code + optional URL |
| `score` | match ends | final team scores and hand count |
| `archive` | match ends | the full replayable playout string |
| `redacted` | match ends | deal + result, names reduced to seat letters |

`roomPattern` is a case-insensitive regex tested against the **normalized**
room code (upper-cased, whitespace collapsed). So `"^LEAGUE"` archives
`league night` and `League  Night` but not `baggle bytes`.

Changes to `announce.json` take effect on backend restart.

## Profanity filter

Room codes and player names are free text typed by whoever shows up, so every
outbound message is screened by `server/profanity.js` before it leaves the
container. A message that trips the filter is dropped, not masked.

Tune it by copying `docker/profanity.example.json` to
`./game-mode-storage/profanity.json`; those lists are merged with the built-in
defaults. Turn the gate off entirely with `ANNOUNCE_BLOCK_PROFANITY=false`.

## Troubleshooting

- **Nothing posts, log says `noop`** — the adapter needs `rpcUrl`, `account`,
  and one of `groupId` / `recipient`. Missing any of them falls back to noop
  with a warning.
- **`signal-cli timed out`** — the daemon isn't reachable. Check
  `docker compose --profile signal ps` and that `SIGNAL_RPC_URL` uses the
  service name `signal`, not `localhost`.
- **Posts are silently dropped** — check the room code against the type's
  `roomPattern`, and whether the profanity gate caught it.
