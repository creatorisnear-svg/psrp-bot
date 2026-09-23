// A staff member went on duty or came off it. Send them a direct message either way.
//
// The game server owns the timing and the totals - it has the database. This only turns what it
// sends into an embed and delivers it, so a Discord outage can never lose a shift.
//
// Clock in and clock out arrive on the same route; `event` says which. Anything that does not say is
// treated as a clock out, which is all the game server ever sent before clock in messages existed.
const { EmbedBuilder } = require('discord.js');

const GREEN = 0x57c46b;
const BLUE = 0x3b82f6;

// "2h 34m" from the game, but recompute defensively so a missing field never prints "undefined".
function readable(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    if (s < 60) return `${s}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function clockInEmbed(config, shift) {
    const started = Number(shift.startedAt) > 0 ? new Date(Number(shift.startedAt) * 1000) : new Date();
    const embed = new EmbedBuilder()
        .setTitle('You are on duty')
        .setColor(BLUE)
        .setDescription('Your staff powers are active and your time is being counted. Type /clockout in game when you are done.')
        .addFields({ name: 'Clocked in', value: `<t:${Math.floor(started.getTime() / 1000)}:t>`, inline: true })
        .setFooter({ text: config.serverName })
        .setTimestamp(started);
    if (shift.rank) embed.addFields({ name: 'Rank', value: String(shift.rank), inline: true });
    if (Number(shift.totalSeconds) > 0) {
        embed.addFields({ name: 'Total on duty so far', value: shift.totalReadable || readable(shift.totalSeconds), inline: true });
    }
    return embed;
}

function clockOutEmbed(config, shift) {
    const embed = new EmbedBuilder()
        .setTitle('Thank you for protecting Palm Springs RP')
        .setColor(GREEN)
        .setDescription(
            shift.endedBy === 'disconnect'
                ? 'You dropped while on duty, so your shift was closed for you and the time still counted.'
                : shift.endedBy === 'restart'
                    ? 'The server restarted while you were on duty, so your shift was closed for you and the time still counted.'
                    : 'Your shift has been logged. Enjoy the rest of your day.'
        )
        .addFields(
            { name: 'This shift', value: shift.readable || readable(shift.seconds), inline: true },
            { name: 'Total on duty', value: shift.totalReadable || readable(shift.totalSeconds), inline: true },
        )
        .setFooter({ text: config.serverName })
        .setTimestamp(new Date());

    if (Number(shift.shifts) > 0) embed.addFields({ name: 'Shifts logged', value: String(shift.shifts), inline: true });
    if (shift.rank) embed.addFields({ name: 'Rank', value: String(shift.rank), inline: true });
    return embed;
}

function buildEmbed(config, shift) {
    return shift.event === 'in' ? clockInEmbed(config, shift) : clockOutEmbed(config, shift);
}

// Returns why it failed rather than throwing: the shift is already saved on the game server, so a
// closed DM is worth a log line and a message back to the player, nothing more.
async function deliver(client, config, shift, log) {
    if (!client) return { ok: false, reason: 'not connected to Discord' };
    const id = String(shift.discord || '');
    if (!/^\d{15,}$/.test(id)) return { ok: false, reason: 'no usable Discord id' };
    const what = shift.event === 'in' ? 'clock in' : 'shift';

    try {
        const user = await client.users.fetch(id);
        await user.send({ embeds: [buildEmbed(config, shift)] });
        log(`${what}: messaged ${user.tag}${shift.event === 'in' ? '' : ` - ${shift.readable || readable(shift.seconds)}`}`);
        return { ok: true };
    } catch (err) {
        // 50007 is "cannot send messages to this user" - DMs closed, or the bot is blocked
        const reason = err && err.code === 50007 ? 'their direct messages are closed' : (err && err.message) || String(err);
        log(`${what}: could not message ${id} (${reason})`);
        return { ok: false, reason };
    }
}

module.exports = { deliver, readable, buildEmbed };
