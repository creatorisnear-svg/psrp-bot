// The small web server Koyeb needs (it health-checks a port), which is also where the game server's
// heartbeat lands.
const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY = 64 * 1024;

function send(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
    res.end(text);
}

function authorised(req, key) {
    const header = String(req.headers.authorization || '');
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    const wanted = Buffer.from(key);
    return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (err) { reject(new Error('bad json')); }
        });
        req.on('error', reject);
    });
}

function startServer(config, game, health, log = console.log) {
    const server = http.createServer(async (req, res) => {
        const path = (req.url || '/').split('?')[0];
        try {
            if (req.method === 'GET' && (path === '/' || path === '/health')) {
                const waiting = [...(health.needs ? health.needs.discord : []), ...(health.needs ? health.needs.game : [])];
                // 200 even while waiting: the service is up, it just has nothing to do yet.
                return send(res, 200, {
                    ok: true,
                    discord: health.discord(),
                    game: game.state.online && game.fresh(),
                    ...(waiting.length ? { waitingFor: waiting } : {}),
                });
            }
            if (req.method === 'POST' && path === '/heartbeat') {
                if (!config.syncKey) return send(res, 503, { error: 'SYNC_KEY is not set on the bot yet' });
                if (!authorised(req, config.syncKey)) return send(res, 401, { error: 'unauthorised' });
                game.heartbeat(await readJson(req));
                return send(res, 200, { ok: true });
            }
            return send(res, 404, { error: 'not found' });
        } catch (err) {
            return send(res, 400, { error: err.message });
        }
    });
    server.listen(config.port, '0.0.0.0', () => log(`web: listening on ${config.port}`));
    return server;
}

module.exports = { startServer };
