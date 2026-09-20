// The status panel: one message in the status channel, edited in place rather than reposted, with
// link buttons underneath.
//
// Everything in it comes from the game server's heartbeat, so the panel is only ever as fresh as
// the last beat. When the server is down that is the honest thing to show, rather than a stale
// player count that looks live.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const GREEN = 0x57c46b;
const RED = 0xe5686c;

const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

function embed(config, state) {
    const online = !!state.online;
    const e = new EmbedBuilder()
        .setTitle(`${config.serverName} Status`)
        .setColor(online ? GREEN : RED)
        .setDescription(
            online
                ? 'Updated every minute with the live player count, the area of patrol and the priority board.'
                : '**The server is offline.** This panel updates itself the moment it comes back.'
        )
        .setTimestamp(new Date())
        .setFooter({ text: 'Palm Springs Roleplay' });

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
        const lines = state.priorities.map((p) => {
            const mark = p.state === 'available' ? '🟢' : p.state === 'active' ? '🔴' : '🟠';
            const what = p.state === 'available' ? 'Available'
                : p.state === 'active' ? 'In Progress'
                : `Cooldown ${clock(p.remaining)}`;
            return `${mark} **${p.label}** — ${what}`;
        });
        e.addFields({ name: 'Priorities', value: lines.join('\n').slice(0, 1024) });
    }

    return e;
}

// Discord only allows link buttons to carry a URL, and a plain button must have a custom id even
// when it is disabled - which the player count is, because it is a readout and not a control.
function buttons(config, state) {
    const row = new ActionRowBuilder();

    row.addComponents(
        new ButtonBuilder()
            .setCustomId('psrp_players')
            .setLabel(state.online
                ? `${state.players} ${state.players === 1 ? 'Player' : 'Players'} in the City`
                : 'Server Offline')
            .setStyle(state.online ? ButtonStyle.Success : ButtonStyle.Danger)
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

module.exports = { embed, buttons, findChannel };
