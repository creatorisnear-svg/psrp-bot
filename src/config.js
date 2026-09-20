// Everything the bot needs comes from environment variables (set them in Koyeb, never in code).
const missing = [];

function read(name, { required = false, fallback = '' } = {}) {
    const value = (process.env[name] || '').trim();
    if (!value && required) missing.push(name);
    return value || fallback;
}

const offline = process.env.BOT_OFFLINE === '1';     // local testing: run the web part without logging in to Discord

const config = {
    offline,
    token: read('DISCORD_TOKEN', { required: !offline }),
    guildId: read('GUILD_ID', { required: !offline }),
    fivemUrl: read('FIVEM_URL', { required: true }).replace(/\/+$/, ''),   // http://ip:port of the game server
    syncKey: read('SYNC_KEY', { required: true }),                          // same value as psrp_discord_sync_key on the game server
    port: Number(process.env.PORT) || 8000,
    serverName: read('SERVER_NAME', { fallback: 'Palm Springs Roleplay' }),
    connectUrl: read('CONNECT_URL'),                  // optional, shown in /status (cfx.re/join/xxxxxx)
    statusChannelId: read('STATUS_CHANNEL_ID'),       // optional, a channel where the bot keeps one status message up to date
};

if (config.syncKey && config.syncKey.length < 16) missing.push('SYNC_KEY (must be at least 16 characters)');

module.exports = { config, missing };
