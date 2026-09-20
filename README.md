# Palm Springs Roleplay - Discord bot

Runs on Koyeb. Works together with the `psrp_discord` resource on the game server.

| Part | Where | What it does |
|---|---|---|
| This bot | Koyeb | Shows the live player count as its status, answers `/status` `/players` `/sync`, and tells the game the moment someone's roles change |
| `psrp_discord` | Game server | Turns Discord roles into staff ranks, department access and head tags. Which role means what is in `resources/psrp_discord/roles.lua` |

The two talk over HTTP with one shared key that you make up. Nothing that key unlocks is sensitive:
the game always reads roles from Discord itself, the bot only says "look again now".

## 1. Discord Developer Portal

1. https://discord.com/developers/applications -> **New Application** -> **Bot**.
2. **Reset Token** and copy it (you will paste it in two places below, nowhere else).
3. On the same page, under **Privileged Gateway Intents**, switch on **Server Members Intent**.
   Without it the bot still runs, but role changes take up to 10 minutes to reach the game instead of seconds.
4. **OAuth2 -> URL Generator**: tick `bot` and `applications.commands`. Bot permissions: `View Channels`,
   `Send Messages`, `Embed Links`, `Read Message History` (only needed for the optional status message).
   Open the link and add the bot to your server. Already invited it? Open the new link anyway - it adds the slash commands.

## 2. Koyeb

1. This repository holds the bot and no secrets, so it can go straight on Koyeb.
2. Koyeb -> **Create Service** -> **Web Service** -> GitHub -> pick this repository.
   Leave **Work directory** empty (the bot is at the root).
   Builder: **Buildpack**. Run command: leave empty (`npm start` is used). Port: **8000**, health check path `/health`.
3. **Environment variables** (mark the first three as *Secret*):

| Name | Value |
|---|---|
| `DISCORD_TOKEN` | the bot token |
| `SYNC_KEY` | any long random text you make up, 16 characters or more |
| `GUILD_ID` | your Discord server id (right-click the server icon -> Copy Server ID) |
| `FIVEM_URL` | `http://23.27.211.21:30136` |
| `CONNECT_URL` | optional - shown in `/status`, e.g. `cfx.re/join/xxxxxx` |
| `STATUS_CHANNEL_ID` | optional - a channel where the bot keeps one status message up to date |
| `SERVER_NAME` | optional - defaults to Palm Springs Roleplay |

4. Deploy, then copy the service's public address (`https://something.koyeb.app`).

**Free instance:** Koyeb puts a free instance to sleep after an hour without incoming requests, which
would take the bot offline. The game server calls the bot once a minute, so it stays awake for as long
as the game server is up. On a paid instance this does not matter.

## 3. Game server

Open `psrp_secrets.cfg` (next to `server.cfg`) in the RocketNode file manager and fill in all four lines:

```
set psrp_discord_token "the bot token"
set psrp_discord_guild "your Discord server id"
set psrp_discord_sync_key "the same text as SYNC_KEY on Koyeb"
set psrp_discord_bot_url "https://something.koyeb.app"
```

Restart the game server.

## 4. Check it

* Discord: the bot is online and shows `0 / 64 in the city`. `/status` answers.
* Game server console after a restart: `[psrp_discord] ready: ...` instead of `idle`.
* Give yourself a mapped role while in game: it applies within a couple of seconds.

## Running the hosting from the command line

`tools/koyeb.py` does logs, redeploys and settings without opening the Koyeb dashboard -
see [tools/README.md](tools/README.md).

```bash
python tools/koyeb.py setup     # once: store your Koyeb API key
python tools/koyeb.py logs      # what the bot has been printing
python tools/koyeb.py deploy    # redeploy now
```

## Local test (no Discord, no game server)

```bash
npm test
```
