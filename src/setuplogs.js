// /setuplogs - build the channels the game logs into.
//
// The bot does NOT create these by itself. Adding seven channels to somebody's Discord is their
// decision, not a side effect of a deploy, so it happens when an admin asks for it. Run it once to
// see the list, again with confirm:true to build it. Running it twice is safe: anything already
// there is left alone.
//
// Every channel is created hidden from @everyone. Staff roles are added afterwards by hand, because
// the bot has no reliable way to tell which of the server's roles count as staff.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { CATEGORIES } = require('./logs');

const PARENT = 'Server Logs';

const definition = new SlashCommandBuilder()
    .setName('setuplogs')
    .setDescription('Create the channels the game server writes its logs into')
    .addBooleanOption((o) => o.setName('confirm').setDescription('Leave off to preview. Set to true to actually create them.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON();

const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The name this guild should use for a category, honouring any LOG_CHANNEL_* override.
const wantedName = (config, category) => config.logChannels[category] || CATEGORIES[category].channel;

async function handle(interaction, config) {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'Run this in the server, not a DM.', flags: MessageFlags.Ephemeral });
    if (interaction.user.id !== guild.ownerId && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need Manage Server to set up the log channels.', flags: MessageFlags.Ephemeral });
    }

    const confirm = interaction.options.getBoolean('confirm') || false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channels = await guild.channels.fetch();
    const existing = new Map();
    for (const channel of channels.values()) {
        if (channel && channel.isTextBased()) existing.set(plain(channel.name), channel);
    }

    const wanted = Object.keys(CATEGORIES).map((category) => ({ category, name: wantedName(config, category) }));
    const missing = wanted.filter((w) => !existing.has(plain(w.name)));
    const present = wanted.filter((w) => existing.has(plain(w.name)));

    const listed = (items) => items.map((w) => {
        const found = existing.get(plain(w.name));
        return found ? `• ${CATEGORIES[w.category].title}: <#${found.id}>` : `• ${CATEGORIES[w.category].title}: #${w.name}`;
    }).join('\n');

    if (!missing.length) {
        return interaction.editReply(`All seven log channels already exist.\n${listed(present)}`);
    }

    if (!confirm) {
        const existingCategory = [...channels.values()].find((c) => c && c.type === ChannelType.GuildCategory
            && (plain(c.name) === plain(PARENT) || plain(c.name).includes('log')));
        return interaction.editReply(
            `This would create ${missing.length} channel${missing.length === 1 ? '' : 's'} `
            + (existingCategory
                ? `under your existing **${existingCategory.name}** category, using its permissions:\n`
                : `under a new **${PARENT}** category, hidden from @everyone:\n`)
            + `${listed(missing)}\n`
            + (present.length ? `\nAlready there, and left alone:\n${listed(present)}\n` : '')
            + '\nRun it again with `confirm: true` to create them.'
        );
    }

    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.editReply('I do not have the **Manage Channels** permission, so I cannot create them. Give it to me and run this again.');
    }

    // Hidden by default. The bot keeps its own access explicitly, so a locked-down category cannot
    // leave it unable to post into channels it just made.
    const hidden = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
    ];

    // Put them where the server already keeps its logs. Making a second log category beside an
    // existing one splits them in two and leaves whoever reads them checking both.
    const categories = [...channels.values()].filter((c) => c && c.type === ChannelType.GuildCategory);
    let parent = categories.find((c) => plain(c.name) === plain(PARENT))
        || categories.find((c) => plain(c.name).includes('log'));
    // Reusing a category means its permissions are already right for whoever reads logs here, so the
    // new channels inherit them. Only a category we make ourselves gets locked down by us.
    const reused = !!parent;
    const made = [];
    const failed = [];
    try {
        if (!parent) {
            parent = await guild.channels.create({ name: PARENT, type: ChannelType.GuildCategory, permissionOverwrites: hidden });
        }
    } catch (err) {
        parent = null;      // no category is survivable; the channels just sit at the top level
        failed.push(`the **${PARENT}** category (${err.message})`);
    }

    for (const w of missing) {
        try {
            const channel = await guild.channels.create({
                name: w.name,
                type: ChannelType.GuildText,
                parent: parent ? parent.id : undefined,
                topic: `${CATEGORIES[w.category].title} from the game server. Written by the bot - do not rename.`,
                ...(reused ? {} : { permissionOverwrites: hidden }),
            });
            made.push(`• ${CATEGORIES[w.category].title}: <#${channel.id}>`);
        } catch (err) {
            failed.push(`#${w.name} (${err.message})`);
        }
    }

    return interaction.editReply(
        (made.length ? `Created:\n${made.join('\n')}\n\n` : '')
        + (failed.length ? `Could not create:\n• ${failed.join('\n• ')}\n\n` : '')
        + (reused
            ? `They are under your existing **${parent.name}** category and use its permissions, so whoever can read your other logs can read these.`
            : `They are under a new **${PARENT}** category, hidden from everyone but me. Add your staff roles to that category so staff can read them.`)
    );
}

module.exports = { definition, handle };
