// A staff member clocked off. Send them their hours as a direct message.
//
// The game server owns the timing and the totals - it has the database. This only turns what it
// sends into an embed and delivers it, so a Discord outage can never lose a shift.
const { EmbedBuilder } = require('discord.js');

const GREEN = 0x57c46b;

// "2h 34m" from the game, but recompute defensively so a missing field never prints "undefined".
function readable(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    if (s < 60) return `${s}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function buildEmbed(config, shift) {
    const embed = new EmbedBuilder()
        .setTitle('Thank you for protecting Palm Springs RP')
        .setColor(GREEN)
        .setDescription(
            shift.endedBy === 'disconnect'
                ? 'You dropped while on duty, so your shift was closed for you and the time still counted.'
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

// Returns why it failed rather than throwing: the shift is already saved on the game server, so a
// closed DM is worth a log line and nothing more.
async function deliver(client, config, shift, log) {
    if (!client) return { ok: false, reason: 'not connected to Discord' };
    const id = String(shift.discord || '');
    if (!/^\d{15,}$/.test(id)) return { ok: false, reason: 'no usable Discord id' };

    try {
        const user = await client.users.fetch(id);
        await user.send({ embeds: [buildEmbed(config, shift)] });
        log(`shift: messaged ${user.tag} - ${shift.readable || readable(shift.seconds)}`);
        return { ok: true };
    } catch (err) {
        // 50007 is "cannot send messages to this user" - DMs closed, or the bot is blocked
        const reason = err && err.code === 50007 ? 'their direct messages are closed' : (err && err.message) || String(err);
        log(`shift: could not message ${id} (${reason})`);
        return { ok: false, reason };
    }
}

module.exports = { deliver, readable, buildEmbed };
