# koyeb.py - run the hosting from the command line

Logs, redeploys and settings for the bot's Koyeb service, without opening the dashboard.
Needs Python 3 (already installed) and nothing else.

## Once

1. Make an API key: https://app.koyeb.com/user/settings/api -> **Create API credential**.
2. Store it (it is typed hidden, saved to `~/.koyeb.env`, and never printed again):

```bash
python tools/koyeb.py setup
```

3. Check it works:

```bash
python tools/koyeb.py whoami
```

## Day to day

```bash
python tools/koyeb.py ls                  # every service: status and last deploy
python tools/koyeb.py info                # one service in detail, with its settings
python tools/koyeb.py logs                # the last 60 lines the bot printed
python tools/koyeb.py logs 200            # more of them
python tools/koyeb.py logs --build        # why a build failed
python tools/koyeb.py deploy              # redeploy now
python tools/koyeb.py deployments         # the last few deploys and how they went
python tools/koyeb.py pause               # stop it   /  resume  to start again
```

## Changing settings

```bash
python tools/koyeb.py set FIVEM_URL=http://23.27.211.21:30136
python tools/koyeb.py set SERVER_NAME="Palm Springs Roleplay" CONNECT_URL=cfx.re/join/xxxxxx
python tools/koyeb.py unset CONNECT_URL
```

Each change starts a new deployment on its own.

**Tokens and keys are not typed here.** `set DISCORD_TOKEN=...` is refused on purpose. Put those in
https://app.koyeb.com/secrets as a Koyeb secret, then point the setting at it:

```bash
python tools/koyeb.py secrets             # the names you have stored
python tools/koyeb.py set DISCORD_TOKEN=@discord-token
```

Secret values are never shown by this tool, and anything that looks like a token or key is blanked
out of the logs it prints.

## If you have more than one service

Put its name first: `python tools/koyeb.py logs psrp-bot 200`.
