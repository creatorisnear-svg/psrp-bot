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

class Logs {
    constructor(config, log = console.log) {
        this.config = config;
        this.log = log;
        this.queues = new Map();      // category -> [line]
        this.channels = new Map();    // category -> channel, cached after the first lookup
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

    start(client, resolveChannel) {
        if (this.timer) return;
        this.timer = setInterval(() => this.flush(client, resolveChannel).catch(() => {}), FLUSH_MS);
        this.timer.unref?.();
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
    }

    async channelFor(category, resolveChannel) {
        if (this.channels.has(category)) return this.channels.get(category);
        const wanted = this.config.logChannels[category] || this.spec(category).channel;
        const channel = await resolveChannel(this.config.guildId, wanted);
        this.channels.set(category, channel);     // cached either way, so a missing channel is not looked up every flush
        if (!channel) this.log(`logs: no channel matching "${wanted}" for ${category} - those entries are being discarded`);
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
