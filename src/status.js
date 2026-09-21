// The status panel: one message in the status channel, edited in place rather than reposted, with
// link buttons underneath.
//
// Everything in it comes from the game server's heartbeat, so the panel is only ever as fresh as
// the last beat. When the server is down that is the honest thing to show, rather than a stale
// player count that looks live.
const path = require('node:path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// The banner lives in the repo, so the panel has it on a fresh deploy with nothing to host.
const BANNER_NAME = 'status-banner.png';
const BANNER_PATH = path.join(__dirname, '..', 'assets', BANNER_NAME);

const GREEN = 0x57c46b;
const RED = 0xe5686c;
const AMBER = 0xffc53d;

const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

// How long until a scheduled restart, in words.
const soon = (seconds) => {
    if (!seconds || seconds <= 0) return 'now';
    if (seconds < 90) return `in under a minute`;
    return `in about ${Math.round(seconds / 60)} minutes`;
};

function embed(config, state, announced, bannerUrl) {
    const online = !!state.online;
    // An announced restart outranks the heartbeat: the server may still be answering while it
    // counts down, and it will stop answering in the middle of one.
    const restarting = announced && announced.state === 'restarting';

    const e = new EmbedBuilder()
        .setTitle(`${config.serverName} Status`)
        .setColor(restarting ? AMBER : online ? GREEN : RED)
        .setDescription(
            restarting
                ? `**Restarting ${soon(announced.seconds)}.** The panel comes back on its own once the server is up.`
                : online
                    ? 'Updated every minute with the live player count, the area of patrol and the priority board.'
                    : '**The server is offline.** This panel updates itself the moment it comes back.'
        )
        .setTimestamp(new Date())
        .setFooter({ text: 'Palm Springs Roleplay' })
        // Either the copy Discord already has, or the file about to be attached.
        .setImage(bannerUrl || `attachment://${BANNER_NAME}`);

    if (restarting && !online) return e;
    if (!online) return e;

    const max = state.max || 0;
    e.addFields(
        { name: 'In the City', value: max ? `**${state.players}** / ${max}` : `**${state.players}**`, inline: true },
        { name: 'Staff On Duty', value: state.staff === null ? '—' : `**${state.staff}**`, inline: true },
        { name: 'Area of Patrol', value: state.aop || '*updating…*', inline: true },
    );

    if (!state.priorities || !state.priorities.length) {
        // Better than an empty box: this is what a player sees in the seconds after a restart.
        e.addFields({ name: 'Priorities', value: '*updating…*' });
    } else if (state.priorities && state.priorities.length) {
        // The game owns the state vocabulary. Known ones get a colour and wording; anything new
        // still renders sensibly instead of falling through to a wrong label.
        const KNOWN = {
            open: ['🟢', 'Open'],
            available: ['🟢', 'Available'],
            hold: ['🔴', 'On Hold'],
            active: ['🔴', 'In Progress'],
            cooldown: ['🟠', 'Cooldown'],
        };
        const lines = state.priorities.map((p) => {
            const [mark, word] = KNOWN[p.state] || ['⚪', String(p.state || '').replace(/^./, (c) => c.toUpperCase())];
            const what = p.remaining > 0 ? `${word} ${clock(p.remaining)}` : word;
            return `${mark} **${p.label}** — ${what}`;
        });
        e.addFields({ name: 'Priorities', value: lines.join('\n').slice(0, 1024) });
    }

    return e;
}

// Discord only allows link buttons to carry a URL, and a plain button must have a custom id even
// when it is disabled - which the player count is, because it is a readout and not a control.
function buttons(config, state, announced) {
    const row = new ActionRowBuilder();
    const restarting = announced && announced.state === 'restarting';

    row.addComponents(
        new ButtonBuilder()
            .setCustomId('psrp_players')
            .setLabel(restarting ? 'Restarting'
                : state.online ? `${state.players} ${state.players === 1 ? 'Player' : 'Players'} in the City`
                : 'Server Offline')
            .setStyle(restarting ? ButtonStyle.Secondary : state.online ? ButtonStyle.Success : ButtonStyle.Danger)
            .setDisabled(true),
    );

    if (/^https?:\/\//.test(config.connectUrl || '')) {
        row.addComponents(new ButtonBuilder().setLabel('Connect').setStyle(ButtonStyle.Link).setURL(config.connectUrl));
    }
    if (/^https?:\/\//.test(config.storeUrl || '')) {
        row.addComponents(new ButtonBuilder().setLabel('Store').setStyle(ButtonStyle.Link).setURL(config.storeUrl));
    }
    return [row];
}

// A channel id, or a channel name like "server-status" - so nobody has to go and copy an id.
async function findChannel(client, guildId, wanted) {
    const target = String(wanted || '').trim();
    if (!target) return null;

    if (/^\d{15,}$/.test(target)) {
        return client.channels.fetch(target).catch(() => null);
    }
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) return null;

    // Channel names are often dressed up with emoji and separators, so compare on the letters only.
    const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = plain(target);
    const match = channels.find((c) => c && c.isTextBased() && plain(c.name) === key)
        || channels.find((c) => c && c.isTextBased() && plain(c.name).includes(key));
    return match || null;
}

module.exports = { embed, buttons, findChannel, BANNER_NAME, BANNER_PATH };
