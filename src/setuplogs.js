// Building the channels the game logs into.
//
// Used two ways: /setuplogs, which an admin runs and which previews before it changes anything, and
// once at start-up when SETUP_LOGS is set, which is how it gets done without anybody having to run
// a command. Both go through the same code, so there is one answer to "where do the logs go".
//
// Running it twice is safe. What counts as "already there" is decided by the SAME resolution the
// logger uses at run time - by id, by name, or by the substring fallback - because checking the
// name alone would miss a channel the bot is already writing to and stand up a second one beside it.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { CATEGORIES } = require('./logs');
const { findChannel } = require('./status');

const PARENT = 'Server Logs';

const definition = new SlashCommandBuilder()
    .setName('setuplogs')
    .setDescription('Create the channels the game server writes its logs into')
    .addBooleanOption((o) => o.setName('confirm').setDescription('Leave off to preview. Set to true to actually create them.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON();

const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const wantedName = (config, category) => config.logChannels[category] || CATEGORIES[category].channel;

// Where the log channels belong: the category this server already keeps logs in, if it has one.
// Making a second log category beside an existing one splits them and leaves whoever reads them
// checking both.
function logCategory(channels) {
    const categories = [...channels.values()].filter((c) => c && c.type === ChannelType.GuildCategory);
    return categories.find((c) => plain(c.name) === plain(PARENT))
        || categories.find((c) => plain(c.name).includes('log'))
        || null;
}

// Which categories have a channel and which do not.
async function survey(client, guild, config) {
    const present = [];
    const missing = [];
    for (const key of Object.keys(CATEGORIES)) {
        const found = await findChannel(client, guild.id, wantedName(config, key));
        // A category with no channel is created under its DEFAULT name, never under whatever the
        // setting says - that setting may be a channel id, and "1545833567223812176" is not a name.
        (found ? present : missing).push({ key, channel: found, name: CATEGORIES[key].channel });
    }
    return { present, missing };
}

// Creates the missing channels. Returns what it made, what it could not, and where it put them.
async function build(client, guild, config, missing) {
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { made: [], failed: [], blocked: 'I do not have the Manage Channels permission' };
    }

    const channels = await guild.channels.fetch();
    let parent = logCategory(channels);
    // A category we reuse already has the right permissions for whoever reads logs there, so the new
    // channels inherit them. Only a category we make ourselves gets locked down by us.
    const reused = !!parent;
    const hidden = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
    ];

    const made = [];
    const failed = [];
    if (!parent) {
        try {
            parent = await guild.channels.create({ name: PARENT, type: ChannelType.GuildCategory, permissionOverwrites: hidden });
        } catch (err) {
            parent = null;      // survivable - the channels just sit at the top level
            failed.push(`the ${PARENT} category (${err.message})`);
        }
    }

    for (const item of missing) {
        try {
            const channel = await guild.channels.create({
                name: item.name,
                type: ChannelType.GuildText,
                parent: parent ? parent.id : undefined,
                topic: `${CATEGORIES[item.key].title} from the game server. Written by the bot - do not rename.`,
                ...(reused ? {} : { permissionOverwrites: hidden }),
            });
            made.push({ ...item, channel });
        } catch (err) {
            failed.push(`#${item.name} (${err.message})`);
        }
    }
    return { made, failed, parent, reused };
}

// The start-up path: create whatever is missing, say what happened, and hand back whether anything
// changed so the caller can rebind straight away instead of waiting for the next retry.
async function runAtStartup(client, config, log) {
    try {
        const guild = await client.guilds.fetch(config.guildId);
        const { present, missing } = await survey(client, guild, config);
        if (!missing.length) {
            return log(`setuplogs: all ${present.length} log channels already exist, nothing to create`);
        }
        const result = await build(client, guild, config, missing);
        if (result.blocked) {
            return log(`setuplogs: ${result.blocked}, so ${missing.length} channel(s) were not created`);
        }
        if (result.made.length) {
            log(`setuplogs: created ${result.made.map((m) => `#${m.channel.name}`).join(', ')}`
                + `${result.parent ? ` under "${result.parent.name}"` : ''}`
                + `${result.reused ? ' (existing category, its permissions)' : ' (new category, hidden from everyone)'}`);
        }
        for (const problem of result.failed) log(`setuplogs: could not create ${problem}`);
        return result.made.length > 0;
    } catch (err) {
        log(`setuplogs: ${err.message}`);
        return false;
    }
}

async function handle(interaction, config) {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'Run this in the server, not a DM.', flags: MessageFlags.Ephemeral });
    if (interaction.user.id !== guild.ownerId && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'You need Manage Server to set up the log channels.', flags: MessageFlags.Ephemeral });
    }

    const confirm = interaction.options.getBoolean('confirm') || false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { present, missing } = await survey(interaction.client, guild, config);
    const listPresent = present.map((p) => `• ${CATEGORIES[p.key].title}: <#${p.channel.id}>`).join('\n');

    if (!missing.length) {
        return interaction.editReply(`Every log category already has a channel.\n${listPresent}`);
    }

    if (!confirm) {
        const channels = await guild.channels.fetch();
        const parent = logCategory(channels);
        return interaction.editReply(
            `This would create ${missing.length} channel${missing.length === 1 ? '' : 's'} `
            + (parent
                ? `under your existing **${parent.name}** category, using its permissions:\n`
                : `under a new **${PARENT}** category, hidden from @everyone:\n`)
            + `${missing.map((m) => `• ${CATEGORIES[m.key].title}: #${m.name}`).join('\n')}\n`
            + (present.length ? `\nAlready there, and left alone:\n${listPresent}\n` : '')
            + '\nRun it again with `confirm: true` to create them.'
        );
    }

    const result = await build(interaction.client, guild, config, missing);
    if (result.blocked) return interaction.editReply(`${result.blocked}. Give it to me and run this again.`);

    return interaction.editReply(
        (result.made.length ? `Created:\n${result.made.map((m) => `• ${CATEGORIES[m.key].title}: <#${m.channel.id}>`).join('\n')}\n\n` : '')
        + (result.failed.length ? `Could not create:\n• ${result.failed.join('\n• ')}\n\n` : '')
        + (result.reused
            ? `They are under your existing **${result.parent.name}** category and use its permissions, so whoever can read your other logs can read these.`
            : `They are under a new **${PARENT}** category, hidden from everyone but me. Add your staff roles to that category so staff can read them.`)
    );
}

module.exports = { definition, handle, runAtStartup, survey };
