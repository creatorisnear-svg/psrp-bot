// Server logs into Discord.
//
// A busy server produces far more events than Discord will accept as individual messages, so
// entries are QUEUED PER CHANNEL and flushed together on a timer. Without that, a shooting or a
// mass disconnect would hit the rate limit and the entries would be dropped - and a log that
// silently drops the busiest moments is worse than no log, because it is trusted.
const { EmbedBuilder } = require('discord.js');

const FLUSH_MS = 2500;          // how often a channel's queue is sent
const MAX_LINES = 18;           // lines per message, so one flush cannot exceed the embed limit
const MAX_QUEUE = 500;          // per channel, so a runaway loop cannot exhaust memory
const MAX_CHARS = 3800;
const MISS_RETRY_MS = 60000;    // how long a "that channel does not exist" answer is believed

// category -> the channel name to look for, and the colour of its embed
const CATEGORIES = {
    joins: { channel: 'logs-joins', colour: 0x57c46b, title: 'Connections' },
    chat: { channel: 'logs-chat', colour: 0x8fa3b8, title: 'Chat' },
    deaths: { channel: 'logs-deaths', colour: 0xe5686c, title: 'Deaths' },
    money: { channel: 'logs-money', colour: 0xffc53d, title: 'Money' },
    items: { channel: 'logs-items', colour: 0xc3a6d6, title: 'Inventory' },
    staff: { channel: 'logs-staff', colour: 0xdfb562, title: 'Staff' },
    server: { channel: 'logs-server', colour: 0x5865f2, title: 'Server' },
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
        const lines = [];
        for (const category of Object.keys(CATEGORIES)) {
            const wanted = this.config.logChannels[category] || this.spec(category).channel;
            const channel = await resolveChannel(this.config.guildId, wanted);
            this.channels.set(category, channel);
            if (channel) {
                lines.push(`${category} -> #${channel.name}`);
            } else {
                this.missedAt.set(category, Date.now());
                lines.push(`${category} -> nothing matching "${wanted}"`);
                missing.push(category);
            }
        }
        this.log(`logs: ${lines.join(' | ')}`);
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

    // A channel that was found is cached for good. A channel that was NOT found is remembered only
    // for a minute: someone creating the channel afterwards should start getting logs by themselves,
    // rather than the bot refusing to look again until its next deploy.
    async channelFor(category, resolveChannel) {
        const cached = this.channels.get(category);
        if (cached) return cached;
        if (this.channels.has(category) && Date.now() - (this.missedAt.get(category) || 0) < MISS_RETRY_MS) return null;

        const wanted = this.config.logChannels[category] || this.spec(category).channel;
        const channel = await resolveChannel(this.config.guildId, wanted);
        this.channels.set(category, channel);
        if (channel) {
            this.missedAt.delete(category);
            this.log(`logs: ${category} -> #${channel.name}`);
        } else {
            this.missedAt.set(category, Date.now());
            this.log(`logs: no channel matching "${wanted}" for ${category} - those entries are being discarded`);
        }
        return channel;
    }

    async flush(client, resolveChannel) {
        if (!client) return;
        for (const [category, queue] of this.queues) {
            if (!queue.length) continue;
            const channel = await this.channelFor(category, resolveChannel);
            if (!channel) { queue.length = 0; continue; }

            const lines = [];
            let size = 0;
            while (queue.length && lines.length < MAX_LINES && size < MAX_CHARS) {
                size += queue[0].length + 1;
                lines.push(queue.shift());
            }
            const spec = this.spec(category);
            const embed = new EmbedBuilder()
                .setColor(spec.colour)
                .setTitle(spec.title)
                .setDescription(lines.join('\n').slice(0, 4000))
                .setTimestamp(new Date());
            if (this.dropped) {
                embed.setFooter({ text: `${this.dropped} entries dropped while the queue was full` });
                this.dropped = 0;
            }
            try {
                await channel.send({ embeds: [embed] });
            } catch (err) {
                this.log(`logs: could not write to #${channel.name} (${err.message})`);
                this.channels.delete(category);   // look it up again next time, in case it was deleted
            }
        }
    }
}

module.exports = { Logs, CATEGORIES };
