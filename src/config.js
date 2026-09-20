// Everything the bot needs comes from environment variables (set them in Koyeb, never in code).
// Nothing here throws: a service deployed before its settings exist should come up, say what it is
// waiting for, and answer its health check, rather than crash-looping in red.

function read(name, fallback = '') {
    return (process.env[name] || '').trim() || fallback;
}

const config = {
    offline: process.env.BOT_OFFLINE === '1',         // local testing: run the web part, skip the Discord login
    token: read('DISCORD_TOKEN'),
    guildId: read('GUILD_ID'),
    fivemUrl: read('FIVEM_URL').replace(/\/+$/, ''),  // http://ip:port of the game server
    syncKey: read('SYNC_KEY'),                        // the same text as psrp_discord_sync_key on the game server
    port: Number(process.env.PORT) || 8000,
    serverName: read('SERVER_NAME', 'Palm Springs Roleplay'),
    connectUrl: read('CONNECT_URL'),                  // optional, shown in /status (cfx.re/join/xxxxxx)
    statusChannelId: read('STATUS_CHANNEL_ID'),       // optional, a channel the bot keeps a status message in
};

// What is stopping each half from working. Empty lists mean that half is ready to run.
const needs = {
    discord: [
        !config.token && 'DISCORD_TOKEN',
        !config.guildId && 'GUILD_ID',
    ].filter(Boolean),
    game: [
        !config.fivemUrl && 'FIVEM_URL',
        !config.syncKey && 'SYNC_KEY',
        config.syncKey && config.syncKey.length < 16 && 'SYNC_KEY (needs to be at least 16 characters)',
    ].filter(Boolean),
};

module.exports = { config, needs };
