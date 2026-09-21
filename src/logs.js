// Server logs into Discord.
//
// A busy server produces far more events than Discord will accept as individual messages, so
// entries are QUEUED PER CHANNEL and flushed together on a timer. Without that, a shooting or a
// mass disconnect would hit the rate limit and the entries would be dropped - and a log that
// silently drops the busiest moments is worse than no log, because it is trusted.
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const FLUSH_MS = 2500;          // how often a channel's queue is sent
const MAX_LINES = 18;           // lines per message, so one flush cannot exceed the embed limit
const MAX_QUEUE = 500;          // per channel, so a runaway loop cannot exhaust memory
const MAX_CHARS = 3800;
const MISS_RETRY_MS = 60000;    // how long a "that channel does not exist" answer is believed

// category -> the channel name to look for, and the colour of its embed.
//
// `private` marks the two that must never be written into a channel the whole server can read. Chat
// carries what players type to each other, including the staff channel and the anonymous VPN board;
// staff carries ban and kick reasons. Posting either in public would do real damage to the server,
// and a misconfigured channel is an easy mistake to make, so those two refuse rather than warn.
// The names follow the "<thing>-logs" style this server already uses for psrpstaff-logs and
// random-logs, rather than imposing a different one alongside them. It also means the staff
// category finds psrpstaff-logs on its own, since "stafflogs" is inside "psrpstafflogs".
const CATEGORIES = {
    joins: { channel: 'join-logs', colour: 0x57c46b, title: 'Connections' },
    chat: { channel: 'chat-logs', colour: 0x8fa3b8, title: 'Chat', private: true },
    deaths: { channel: 'death-logs', colour: 0xe5686c, title: 'Deaths' },
    money: { channel: 'money-logs', colour: 0xffc53d, title: 'Money' },
    items: { channel: 'item-logs', colour: 0xc3a6d6, title: 'Inventory' },
    staff: { channel: 'staff-logs', colour: 0xdfb562, title: 'Staff', private: true },
    server: { channel: 'server-logs', colour: 0x5865f2, title: 'Server' },
};
const FALLBACK = { channel: 'logs', colour: 0x8b9099, title: 'Log' };

const stamp = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;

// Discord renders these as formatting, and a player name is attacker-controlled text.
const clean = (s) => String(s == null ? '' : s).replace(/[`*_~|\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);

// Channel names are dressed up with emoji and separators, so they are compared on the letters only -
// the same normalisation findChannel uses.
const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

class Logs {
    constructor(config, log = console.log) {
        this.config = config;
        this.log = log;
        this.queues = new Map();      // category -> [line]
        this.channels = new Map();    // category -> channel, cached after the first lookup
        this.missedAt = new Map();    // category -> when the lookup last found nothing
        this.wrote = new Set();       // channel ids we have successfully posted in at least once
        this.dropped = 0;
        this.timer = null;
    }

    spec(category) {
        return CATEGORIES[category] || FALLBACK;
    }

    // Called by the HTTP handler. Never throws and never waits - the game must not block on Discord.
    add(entry) {
        const category = CATEGORIES[entry.category] ? entry.category : 'server';
        const queue = this.queues.get(category) || [];
        if (queue.length >= MAX_QUEUE) {
            this.dropped += 1;
            return false;
        }
        const who = clean(entry.who);
        const line = `\`${stamp(new Date())}\` ${who ? `**${who}** ` : ''}${clean(entry.text)}`;
        queue.push(line);
        this.queues.set(category, queue);
        return true;
    }

    start(client, resolveChannel, listChannels = null) {
        if (this.timer) return;
        this.timer = setInterval(() => this.flush(client, resolveChannel).catch(() => {}), FLUSH_MS);
        this.timer.unref?.();
        this.audit(resolveChannel, listChannels).catch(() => {});
    }

    // Say at start-up where each category is going. Silence here used to mean either "working" or
    // "every entry is being thrown away because the channel is named something else" - the same
    // silence for both. When a category finds nothing, the channels that look like log channels are
    // listed with their ids, so the name can be corrected instead of guessed at.
    async audit(resolveChannel, listChannels) {
        const missing = [];
        for (const category of Object.keys(CATEGORIES)) {
            // channelFor does the resolving, the fallback and the privacy check, and says where each
            // one landed - so this stays the one description of where a category goes.
            const channel = await this.channelFor(category, resolveChannel);
            if (!channel) missing.push(category);
        }
        if (!missing.length || !listChannels) return;

        const all = await listChannels().catch(() => []);
        const text = all.filter((c) => c.text);
        if (!text.length) return this.log('logs: could not read the channel list');

        // Grouped by the Discord category they sit under, because log channels are nearly always
        // gathered under one - and the useful ones are often named "join-leave" or "economy", with
        // no "log" in the name at all, so filtering on the channel name alone hides them.
        const byParent = new Map();
        for (const channel of text) {
            const parent = channel.parent || '(no category)';
            if (!byParent.has(parent)) byParent.set(parent, []);
            byParent.get(parent).push(channel);
        }
        const interesting = [...byParent.entries()].filter(([parent, list]) =>
            plain(parent).includes('log') || list.some((c) => plain(c.name).includes('log')));
        const shown = interesting.length ? interesting : [...byParent.entries()];

        this.log(`logs: ${missing.length} categor${missing.length === 1 ? 'y has' : 'ies have'} no channel. What this server has`
            + `${interesting.length ? ' that looks log-related' : ''}:`);
        for (const [parent, list] of shown.slice(0, 40)) {
            this.log(`logs:   under "${parent}": ${list.map((c) => `"${c.name}" ${c.id}`).join(', ')}`.slice(0, 1800));
        }
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }

    // Can everyone in the Discord server read this channel? Unknown counts as yes, because guessing
    // "private" wrongly is the expensive direction.
    everyoneCanRead(channel) {
        try {
            const everyone = channel.guild.roles.everyone;
            return !!channel.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel);
        } catch {
            return true;
        }
    }

    // A channel that was found is cached for good. A channel that was NOT found is remembered only
    // for a minute: someone creating the channel afterwards should start getting logs by themselves,
    // rather than the bot refusing to look again until its next deploy. When a category has no
    // channel of its own, LOG_CHANNEL_FALLBACK takes the entries so nothing is thrown away while
    // the proper channels are still being made.
    async channelFor(category, resolveChannel) {
        const cached = this.channels.get(category);
        if (cached) return cached;
        if (this.channels.has(category) && Date.now() - (this.missedAt.get(category) || 0) < MISS_RETRY_MS) return null;

        const spec = this.spec(category);
        const wanted = this.config.logChannels[category] || spec.channel;
        let channel = await resolveChannel(this.config.guildId, wanted);
        let viaFallback = false;
        if (!channel && this.config.logFallback) {
            channel = await resolveChannel(this.config.guildId, this.config.logFallback);
            viaFallback = !!channel;
        }

        if (channel && spec.private && this.everyoneCanRead(channel)) {
            this.log(`logs: refusing to write ${category} into #${channel.name} - everyone in the server can read it, `
                + 'and these entries are not for everyone. Make the channel private, or point this category somewhere else.');
            channel = null;
        }

        this.channels.set(category, channel);
        if (channel) {
            this.missedAt.delete(category);
            this.log(`logs: ${category} -> #${channel.name}${viaFallback ? ' (fallback - it has no channel of its own yet)' : ''}`);
        } else {
            this.missedAt.set(category, Date.now());
            this.log(`logs: no channel matching "${wanted}" for ${category} - those entries are being discarded`);
        }
        return channel;
    }

    async flush(client, resolveChannel) {
        if (!client) return;

        // Resolve first, then group BY CHANNEL. Several categories often share one - a fallback
        // channel, or a server that keeps all its logs in one place - and one message per category
        // into the same channel is six messages every few seconds, which Discord rate limits.
        const byChannel = new Map();
        for (const [category, queue] of this.queues) {
            if (!queue.length) continue;
            const channel = await this.channelFor(category, resolveChannel);
            if (!channel) { queue.length = 0; continue; }
            if (!byChannel.has(channel.id)) byChannel.set(channel.id, { channel, parts: [] });
            byChannel.get(channel.id).parts.push({ category, queue });
        }

        for (const { channel, parts } of byChannel.values()) {
            const mixed = parts.length > 1;
            const lines = [];
            let size = 0;
            // Round robin, so one loud category cannot starve the others out of every message.
            let took = true;
            while (took && lines.length < MAX_LINES && size < MAX_CHARS) {
                took = false;
                for (const part of parts) {
                    if (!part.queue.length || lines.length >= MAX_LINES || size >= MAX_CHARS) continue;
                    const line = mixed ? `${this.spec(part.category).title} ${part.queue.shift()}` : part.queue.shift();
                    size += line.length + 1;
                    lines.push(line);
                    took = true;
                }
            }
            if (!lines.length) continue;
            // Every line starts with its own timestamp, so sorting puts a mixed channel back into
            // the order the events actually happened in.
            if (mixed) lines.sort((a, b) => (a.slice(a.indexOf('`')) < b.slice(b.indexOf('`')) ? -1 : 1));

            const spec = mixed ? FALLBACK : this.spec(parts[0].category);
            const embed = new EmbedBuilder()
                .setColor(spec.colour)
                .setTitle(mixed ? 'Server log' : spec.title)
                .setDescription(lines.join('\n').slice(0, 4000))
                .setTimestamp(new Date());
            if (this.dropped) {
                embed.setFooter({ text: `${this.dropped} entries dropped while the queue was full` });
                this.dropped = 0;
            }
            try {
                await channel.send({ embeds: [embed] });
                // Resolving a channel and being allowed to post in it are different things, and the
                // difference only shows on the first real entry. Say so once, then stay quiet.
                if (!this.wrote.has(channel.id)) {
                    this.wrote.add(channel.id);
                    this.log(`logs: first entry written to #${channel.name}`);
                }
            } catch (err) {
                this.log(`logs: could not write to #${channel.name} (${err.message})`);
                // Look the channel up again next time, in case it was deleted or renamed.
                for (const part of parts) this.channels.delete(part.category);
            }
        }
    }
}

module.exports = { Logs, CATEGORIES };
