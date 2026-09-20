// The game server as the bot sees it.
//   game -> bot   a heartbeat every minute (player count, names, staff online, AOP). It also keeps a
//                 free Koyeb instance awake, because that only sleeps when nothing calls it.
//   bot -> game   "re-read this member's roles now" when roles change in Discord.
// Nothing sent either way is secret: the game always reads roles from Discord itself.

const TIMEOUT_MS = 8000;
const HEARTBEAT_FRESH_MS = 150000;      // two and a half missed beats = stop trusting it
const SYNC_DEBOUNCE_MS = 1500;          // roles usually change a few at a time

class Game {
    constructor(config, log = console.log) {
        this.config = config;
        this.log = log;
        this.state = { at: 0, online: false, players: 0, max: 0, staff: null, aop: null, priorities: [], list: [], source: 'none' };
        this.pending = new Set();
        this.syncTimer = null;
        this.reloadTimer = null;
    }

    // ---- game -> bot ---------------------------------------------------------------------------
    heartbeat(body) {
        const list = Array.isArray(body.list) ? body.list : [];
        const aop = typeof body.aop === 'string' && body.aop.trim() ? body.aop.trim().slice(0, 60) : null;
        const priorities = Array.isArray(body.priorities) && body.priorities.length
            ? body.priorities.slice(0, 12).map((p) => ({
                label: String(p.label || p.id || '').slice(0, 40),
                state: String(p.state || ''),
                remaining: Number(p.remaining) || 0,
            }))
            : null;

        this.state = {
            at: Date.now(),
            online: true,
            players: Number.isFinite(Number(body.players)) ? Number(body.players) : list.length,
            max: Number(body.max) || 0,
            staff: Number.isFinite(Number(body.staff)) ? Number(body.staff) : null,
            // Kept from the last beat that had them. The game always sends a default, so a beat
            // without them means psrp_hud had not started yet, not that they were cleared.
            aop: aop || this.state.aop,
            priorities: priorities || this.state.priorities,
            list: list.slice(0, 256).map((p) => ({ id: Number(p.id) || 0, name: String(p.name || 'Unknown').slice(0, 48) })),
            source: 'heartbeat',
        };
    }

    // Seconds since the last heartbeat, or null if none has ever arrived. Without this, "the server
    // just restarted" and "the server is sending empty data" look identical from outside.
    ageSeconds() {
        return this.state.at ? Math.round((Date.now() - this.state.at) / 1000) : null;
    }

    fresh() {
        return Date.now() - this.state.at < HEARTBEAT_FRESH_MS;
    }

    // No recent heartbeat (the key is not set on the game server yet, or it is down): ask its public endpoints.
    async poll() {
        try {
            const [dynamic, players] = await Promise.all([this.get('/dynamic.json'), this.get('/players.json')]);
            const list = Array.isArray(players) ? players.filter((p) => p && p.name && Number(p.id) > 0) : [];
            this.state = {
                ...this.state,
                at: Date.now(), online: true, source: 'poll',
                players: list.length, max: Number(dynamic && dynamic.sv_maxclients) || 0,
                staff: null, aop: null, priorities: [],
                list: list.map((p) => ({ id: Number(p.id), name: String(p.name).slice(0, 48) })),   // names and ids only, never identifiers
            };
        } catch (err) {
            this.state = { ...this.state, at: Date.now(), online: false, players: 0, list: [], staff: null, source: 'poll' };
        }
        return this.state;
    }

    async status() {
        if (this.state.source === 'heartbeat' && this.fresh()) return this.state;
        if (this.state.source === 'poll' && Date.now() - this.state.at < 20000) return this.state;
        return this.poll();
    }

    // ---- bot -> game ---------------------------------------------------------------------------
    queueSync(discordId) {
        this.pending.add(String(discordId));
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => {
            const ids = [...this.pending];
            this.pending.clear();
            this.syncNow(ids).catch(() => {});
        }, SYNC_DEBOUNCE_MS);
    }

    async syncNow(ids) {
        try {
            const result = await this.post('/psrp_discord/sync', { discord: ids });
            this.log(`role sync: ${ids.length} member(s), ${result && result.online ? result.online : 0} of them in game`);
            return { ok: true, online: (result && result.online) || 0 };
        } catch (err) {
            this.log(`role sync failed (${err.message}). The game re-reads roles on its own within 10 minutes.`);
            return { ok: false, error: err.message };
        }
    }

    queueReload() {      // a role was created, renamed or deleted: the game should re-read the role list
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
            this.post('/psrp_discord/reload', {}).then(() => this.log('asked the game to re-read the role list')).catch((err) => this.log(`reload failed (${err.message})`));
        }, 5000);
    }

    // ---- plumbing ------------------------------------------------------------------------------
    async get(path) {
        const res = await fetch(this.config.fivemUrl + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async post(path, body) {
        const res = await fetch(this.config.fivemUrl + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.syncKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json().catch(() => ({}));
    }
}

module.exports = { Game };
