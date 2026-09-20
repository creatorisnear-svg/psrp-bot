// Palm Springs Roleplay - Discord bot.
//   * shows the live player count as its status, answers /status /players /sync
//   * the moment someone's roles change in Discord, tells the game server to re-read them, so staff
//     ranks and departments follow Discord within seconds instead of minutes
//   * optional: keeps one status message up to date in a channel (STATUS_CHANNEL_ID)
// Which role means what is decided on the game server (resources/psrp_discord/roles.lua), not here.

const { config, missing } = require('./config');
const { Game } = require('./game');
const { startServer } = require('./http');

const log = (text) => console.log(`[${new Date().toISOString()}] ${text}`);

if (missing.length) {
    console.error(`Missing settings: ${missing.join(', ')}. Add them as environment variables in Koyeb (see README.md).`);
    process.exit(1);
}

const game = new Game(config, log);
let client = null;
let discordReady = false;
const server = startServer(config, game, { discord: () => discordReady }, log);

// ---- Discord ------------------------------------------------------------------------------------
async function startDiscord() {
    const { Client, GatewayIntentBits, Partials, ActivityType, Events } = require('discord.js');
    const commands = require('./commands');

    let lastPresence = '';
    let statusMessage = null;
    let statusFailures = 0;
    let timersStarted = false;

    const sameRoles = (before, after) => {
        const a = before.roles.cache;
        const b = after.roles.cache;
        return a.size === b.size && a.every((_, id) => b.has(id));
    };

    async function refreshPresence() {
        if (!client || !client.user) return;
        const state = await game.status();
        const text = state.online ? `${state.players}${state.max ? ` / ${state.max}` : ''} in the city` : 'Server offline';
        const status = state.online ? 'online' : 'idle';
        if (`${status}|${text}` === lastPresence) return;
        lastPresence = `${status}|${text}`;
        client.user.setPresence({ status, activities: [{ type: ActivityType.Custom, name: 'status', state: text }] });
    }

    async function refreshStatusMessage() {
        if (statusFailures >= 5) return;        // wrong channel or missing permissions: said once below, not every minute
        try {
            const channel = await client.channels.fetch(config.statusChannelId);
            if (!channel || !channel.isTextBased()) throw new Error('that is not a text channel');
            const embed = commands.statusEmbed(config, await game.status());
            if (!statusMessage) {
                const recent = await channel.messages.fetch({ limit: 20 });
                statusMessage = recent.find((m) => m.author.id === client.user.id) || null;
            }
            if (statusMessage) await statusMessage.edit({ embeds: [embed] });
            else statusMessage = await channel.send({ embeds: [embed] });
            statusFailures = 0;
        } catch (err) {
            statusMessage = null;
            statusFailures += 1;
            if (statusFailures === 5) log(`status message: giving up (${err.message}). The bot needs View Channel, Send Messages, Embed Links and Read Message History in STATUS_CHANNEL_ID.`);
        }
    }

    function wire(instance) {
        instance.once(Events.ClientReady, async (ready) => {
            discordReady = true;
            log(`discord: logged in as ${ready.user.tag}`);
            const guild = await ready.guilds.fetch(config.guildId).catch(() => null);
            if (!guild) log('WARNING: the bot is not in the Discord server named by GUILD_ID. Invite it, then redeploy.');
            try {
                await ready.application.commands.set(commands.definitions, config.guildId);
                log('discord: slash commands registered (/status /players /sync)');
            } catch (err) {
                log(`WARNING: could not register slash commands (${err.message}). Re-invite the bot with the applications.commands scope.`);
            }
            if (timersStarted) return;
            timersStarted = true;
            refreshPresence().catch(() => {});
            setInterval(() => refreshPresence().catch(() => {}), 30000);
            if (config.statusChannelId) {
                refreshStatusMessage();
                setInterval(refreshStatusMessage, 60000);
            }
        });

        instance.on(Events.InteractionCreate, (interaction) => {
            commands.handle(interaction, { config, game }).catch((err) => log(`command failed: ${err.message}`));
        });

        // Roles changed, or the member left: the game re-reads that one member from Discord.
        instance.on(Events.GuildMemberUpdate, (before, after) => {
            if (after.guild.id !== config.guildId) return;
            if (!before.partial && sameRoles(before, after)) return;
            game.queueSync(after.id);
        });
        instance.on(Events.GuildMemberRemove, (member) => {
            if (member.guild.id === config.guildId) game.queueSync(member.id);
        });
        // A role itself was created, renamed or deleted: roles.lua may name it.
        instance.on(Events.GuildRoleCreate, (role) => { if (role.guild.id === config.guildId) game.queueReload(); });
        instance.on(Events.GuildRoleDelete, (role) => { if (role.guild.id === config.guildId) game.queueReload(); });
        instance.on(Events.GuildRoleUpdate, (before, after) => {
            if (after.guild.id === config.guildId && before.name !== after.name) game.queueReload();
        });

        instance.on(Events.Error, (err) => log(`discord error: ${err.message}`));
        instance.on(Events.ShardDisconnect, () => { discordReady = false; });
        instance.on(Events.ShardResume, () => { discordReady = true; });
        instance.on(Events.ShardReady, () => { discordReady = true; });
    }

    const build = (withMembers) => new Client({
        intents: withMembers ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] : [GatewayIntentBits.Guilds],
        partials: [Partials.GuildMember],
    });

    client = build(true);
    wire(client);
    try {
        await client.login(config.token);
        log('discord: instant role sync is on');
    } catch (err) {
        if (!(err && (err.code === 'DisallowedIntents' || /disallowed intents|privileged intent/i.test(String(err.message))))) throw err;
        // The switch is off in the Developer Portal: run without it rather than not at all.
        log('WARNING: "Server Members Intent" is off for this bot (Developer Portal > Bot > Privileged Gateway Intents).');
        log('         Running without it: role changes reach the game within 10 minutes instead of instantly.');
        client.destroy();
        client = build(false);
        wire(client);
        await client.login(config.token);
    }
}

if (config.offline) {
    log('BOT_OFFLINE=1: web server only, not logging in to Discord');
} else {
    startDiscord().catch((err) => {
        const reason = err && err.code === 'TokenInvalid'
            ? 'Discord rejected DISCORD_TOKEN. Reset the token in the Developer Portal and update it in Koyeb.'
            : (err && err.message) || String(err);
        console.error(`Could not start the Discord side: ${reason}`);
        process.exit(1);
    });
}

// Koyeb sends SIGTERM when it replaces the instance.
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        log(`${signal}: shutting down`);
        if (client) client.destroy();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
    });
}
process.on('unhandledRejection', (err) => log(`unhandled: ${(err && err.message) || err}`));
