// /renameroles - swap a prefix on every role that has it, e.g. "BlueRP | " -> "PSRP | ".
//
// Only the server owner may run it, and it shows what it would do before it does anything: run it
// once to see the list, then again with confirm:true. Discord itself stops a bot touching any role
// at or above its own, so anything out of reach is reported rather than silently skipped.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const definition = new SlashCommandBuilder()
    .setName('renameroles')
    .setDescription('Replace a prefix on every role that starts with it')
    .addStringOption((o) => o.setName('from').setDescription('The prefix to replace, e.g. "BlueRP | "').setRequired(true))
    .addStringOption((o) => o.setName('to').setDescription('What to replace it with, e.g. "PSRP | "').setRequired(true))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Leave off to preview. Set to true to actually rename.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON();

async function handle(interaction) {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'Run this in the server, not a DM.', flags: MessageFlags.Ephemeral });
    if (interaction.user.id !== guild.ownerId) {
        return interaction.reply({ content: 'Only the server owner can rename roles with this.', flags: MessageFlags.Ephemeral });
    }

    const from = interaction.options.getString('from');
    const to = interaction.options.getString('to');
    const confirm = interaction.options.getBoolean('confirm') || false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply('I do not have the **Manage Roles** permission, so I cannot rename anything. Give it to me, run this again, then take it away.');
    }

    await guild.roles.fetch();
    const matching = [...guild.roles.cache.values()].filter((r) => r.name.startsWith(from) && !r.managed);
    if (!matching.length) return interaction.editReply(`No roles start with \`${from}\`.`);

    const myTop = me.roles.highest.position;
    const reachable = matching.filter((r) => r.position < myTop);
    const tooHigh = matching.filter((r) => r.position >= myTop);

    const preview = (list) => list.slice(0, 20).map((r) => `\`${r.name}\` -> \`${to}${r.name.slice(from.length)}\``).join('\n')
        + (list.length > 20 ? `\n...and ${list.length - 20} more` : '');

    if (!confirm) {
        let text = `**Preview only - nothing changed.**\n${reachable.length} role(s) would be renamed:\n${preview(reachable)}`;
        if (tooHigh.length) {
            text += `\n\n**${tooHigh.length} out of reach**, because they sit at or above my own role. `
                + 'Drag my role higher in Server Settings > Roles to include them:\n'
                + tooHigh.slice(0, 15).map((r) => `\`${r.name}\``).join(', ');
        }
        text += `\n\nRun it again with \`confirm: true\` to apply.`;
        return interaction.editReply(text.slice(0, 1950));
    }

    const done = [];
    const failed = [];
    for (const role of reachable) {
        try {
            await role.setName(to + role.name.slice(from.length), `renameroles by ${interaction.user.tag}`);
            done.push(role.name);
        } catch (err) {
            failed.push(`${role.name} (${err.message})`);
        }
    }

    let text = `Renamed **${done.length}** role(s).`;
    if (tooHigh.length) text += `\n${tooHigh.length} were out of reach (at or above my role): ` + tooHigh.slice(0, 10).map((r) => `\`${r.name}\``).join(', ');
    if (failed.length) text += `\n${failed.length} failed: ${failed.slice(0, 5).join('; ')}`;
    if (done.length) text += '\n\nYou can take **Manage Roles** away from me again now.';
    return interaction.editReply(text.slice(0, 1950));
}

module.exports = { definition, handle };
