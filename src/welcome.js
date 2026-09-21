// Greets a new member in the welcome channel.
//
// The channels it points at are resolved by NAME at send time rather than pinned to ids, so
// renaming or rebuilding a channel does not quietly turn the links into dead text.
const { EmbedBuilder } = require('discord.js');

const GREEN = 0x39ff14;      // the green from the server logo

// name to look for -> what to call it if the channel is not found
const LINKS = [
    { look: 'discord-rules', label: 'Read the rules', icon: '📜' },
    { look: 'server-status', label: 'Check server status', icon: '🌐' },
    { look: 'announcements', label: 'Check announcements', icon: '🔔' },
    { look: 'general-support', label: 'Need help?', icon: '🔨' },
];

const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function findChannel(channels, wanted) {
    const key = plain(wanted);
    return channels.find((c) => c && c.isTextBased() && plain(c.name) === key)
        || channels.find((c) => c && c.isTextBased() && plain(c.name).includes(key))
        || null;
}

async function build(member, config) {
    const guild = member.guild;
    const channels = await guild.channels.fetch().catch(() => null);

    const lines = LINKS.map((link) => {
        const found = channels ? findChannel(channels, link.look) : null;
        // "Need help?" already ends in punctuation, so it does not also take a colon
        const sep = link.label.endsWith('?') ? '' : ':';
        return `${link.icon} ${link.label}${sep} ${found ? `<#${found.id}>` : `#${link.look}`}`;
    });

    return new EmbedBuilder()
        .setColor(GREEN)
        .setTitle(`Welcome ${member.displayName}`)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setDescription(
            `Welcome ${member} to 🌴 **${config.serverName}** 🌴\n\n`
            + 'We are glad to have you here. Before you hit the streets, make sure you check out:\n\n'
            + `${lines.join('\n')}\n\n`
            + 'Whether you are here to build your empire, serve the community, or make your mark in '
            + 'Palm Springs, there is always something going on.\n\n'
            + 'Stay safe, have fun, and enjoy your time in Palm Springs RP!'
        )
        .setFooter({ text: `Member #${guild.memberCount}` })
        .setTimestamp(new Date());
}

async function greet(member, config, resolveChannel, log) {
    if (config.welcomeChannel === '') return;                 // switched off
    if (member.user.bot) return;                              // bots do not need the tour
    try {
        const channel = await resolveChannel(member.guild.id, config.welcomeChannel);
        if (!channel) return log(`welcome: no channel matching "${config.welcomeChannel}"`);
        await channel.send({ content: `${member}`, embeds: [await build(member, config)] });
        log(`welcome: greeted ${member.user.tag} in #${channel.name}`);
    } catch (err) {
        log(`welcome: could not greet ${member.user.tag} (${err.message})`);
    }
}

module.exports = { greet, build };
