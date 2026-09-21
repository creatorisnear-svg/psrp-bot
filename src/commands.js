// Slash commands. Registered for the one guild at start-up, so changes show immediately.
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const renameroles = require('./renameroles');
const setuplogs = require('./setuplogs');
const welcome = require('./welcome');

const NEUTRAL = 0x2b2d31;
const GREEN = 0x57c46b;
const RED = 0xe5686c;

const definitions = [
    new SlashCommandBuilder().setName('status').setDescription('Is the server up, and how many people are in the city?'),
    new SlashCommandBuilder().setName('players').setDescription('Who is in the city right now'),
    new SlashCommandBuilder()
        .setName('testwelcome')
        .setDescription('See the welcome message a new member would get')
        .addBooleanOption((o) => o.setName('post').setDescription('Actually post it in the welcome channel, rather than showing it only to you')),
    new SlashCommandBuilder()
        .setName('sync')
        .setDescription('Re-read Discord roles in game right now (staff ranks, departments)')
        .addUserOption((o) => o.setName('member').setDescription('Someone else (needs Manage Roles). Leave empty for yourself.')),
].map((c) => c.toJSON()).concat([renameroles.definition, setuplogs.definition]);

const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

function statusEmbed(config, state) {
    const embed = new EmbedBuilder().setTitle(config.serverName).setColor(state.online ? GREEN : RED).setTimestamp(new Date());
    if (!state.online) return embed.setDescription('The server is **offline** right now.');

    embed.addFields({ name: 'Status', value: 'Online', inline: true }, { name: 'In the city', value: `${state.players}${state.max ? ` / ${state.max}` : ''}`, inline: true });
    if (state.staff !== null) embed.addFields({ name: 'Staff on', value: String(state.staff), inline: true });
    if (state.aop) embed.addFields({ name: 'Area of patrol', value: state.aop, inline: true });
    if (state.priorities.length) {
        const lines = state.priorities.map((p) => `${p.label}: ${p.state === 'cooldown' ? `cooldown ${clock(p.remaining)}` : p.state === 'active' ? 'in progress' : 'available'}`);
        embed.addFields({ name: 'Priorities', value: lines.join('\n').slice(0, 1024) });
    }
    if (config.connectUrl) embed.addFields({ name: 'Connect', value: config.connectUrl });
    return embed;
}

function playersEmbed(config, state) {
    const embed = new EmbedBuilder().setTitle(`${config.serverName} - in the city`).setColor(NEUTRAL).setTimestamp(new Date());
    if (!state.online) return embed.setColor(RED).setDescription('The server is **offline** right now.');
    if (!state.list.length) return embed.setDescription('Nobody is in the city right now.');
    const lines = state.list.slice().sort((a, b) => a.id - b.id).map((p) => `\`${String(p.id).padStart(3, ' ')}\`  ${p.name.replace(/[`*_~|>\\]/g, '')}`);
    let text = '';
    for (const line of lines) {
        if (text.length + line.length + 1 > 3900) { text += '\n...'; break; }
        text += (text ? '\n' : '') + line;
    }
    return embed.setDescription(text).setFooter({ text: `${state.players}${state.max ? ` / ${state.max}` : ''} players` });
}

async function handle(interaction, { config, game, findChannel }) {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'renameroles') return renameroles.handle(interaction);
    if (interaction.commandName === 'setuplogs') return setuplogs.handle(interaction, config);

    if (interaction.commandName === 'testwelcome') {
        const guild = interaction.guild;
        if (!guild) return interaction.reply({ content: 'Run this in the server.', flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== guild.ownerId && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({ content: 'You need Manage Server to preview this.', flags: MessageFlags.Ephemeral });
        }
        const post = interaction.options.getBoolean('post') || false;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await guild.members.fetch(interaction.user.id);
        const built = await welcome.build(member, config);
        if (!post) return interaction.editReply({ content: 'This is what a new member sees. Nobody else can see this preview.', embeds: [built] });

        const channel = await findChannel(guild.id, config.welcomeChannel);
        if (!channel) return interaction.editReply(`No channel matching "${config.welcomeChannel}".`);
        await channel.send({ content: `${member}`, embeds: [built] });
        return interaction.editReply(`Posted in <#${channel.id}>.`);
    }

    if (interaction.commandName === 'status') {
        await interaction.deferReply();
        return interaction.editReply({ embeds: [statusEmbed(config, await game.status())] });
    }

    if (interaction.commandName === 'players') {
        await interaction.deferReply();
        return interaction.editReply({ embeds: [playersEmbed(config, await game.status())] });
    }

    if (interaction.commandName === 'sync') {
        const target = interaction.options.getUser('member') || interaction.user;
        if (target.id !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({ content: 'You need the Manage Roles permission to sync someone else.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await game.syncNow([target.id]);
        if (!result.ok) return interaction.editReply('The game server did not answer. It re-reads roles on its own within 10 minutes, and whenever someone joins.');
        const who = target.id === interaction.user.id ? 'You are' : `<@${target.id}> is`;
        return interaction.editReply(result.online
            ? `${who} in the city - the roles were re-read just now.`
            : `${who} not in the city right now. Roles are read automatically when joining.`);
    }
}

module.exports = { definitions, handle, statusEmbed };
