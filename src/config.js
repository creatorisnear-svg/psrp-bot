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
    connectUrl: read('CONNECT_URL'),                  // optional, a cfx.re/join link for the Connect button
    storeUrl: read('STORE_URL', 'https://psrpnetwork.online'),
    // A channel id, or just its name - "server-status" works, emoji and separators and all.
    statusChannelId: read('STATUS_CHANNEL_ID') || read('STATUS_CHANNEL'),
    // Where new members are greeted. Set WELCOME_CHANNEL to an empty string to switch it off.
    welcomeChannel: process.env.WELCOME_CHANNEL === '' ? '' : read('WELCOME_CHANNEL', 'welcome'),
    // Per-category log channels. LOG_CHANNEL_JOINS=... overrides one; anything unset falls back to
    // the category default (logs-joins, logs-chat, and so on).
    logChannels: Object.fromEntries(
        ['joins', 'chat', 'deaths', 'money', 'items', 'staff', 'server']
            .map((k) => [k, read(`LOG_CHANNEL_${k.toUpperCase()}`)])
            .filter(([, v]) => v),
    ),
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
