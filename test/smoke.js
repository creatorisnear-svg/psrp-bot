// Runs without Discord and without the real game server:  npm test
// A fake game server stands in for FiveM; the bot's web server and game client are the real code.
const http = require('node:http');
const assert = require('node:assert');
const { Game } = require('../src/game');
const { startServer } = require('../src/http');

const KEY = 'test-key-0123456789abcdef';
const calls = [];

const fakeFivem = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
        calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/dynamic.json') return res.end(JSON.stringify({ clients: 2, sv_maxclients: '64' }));
        if (req.url === '/players.json') return res.end(JSON.stringify([{ id: 0, name: 'Player' }, { id: 4, name: 'dahlia', identifiers: ['license:secret'] }, { id: 9, name: 'theo', identifiers: ['discord:1'] }]));
        if (req.url === '/psrp_discord/sync') return res.end(JSON.stringify({ ok: true, online: 1 }));
        res.statusCode = 404;
        res.end('{}');
    });
});

const listen = (server, port) => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    await listen(fakeFivem, 0);
    const config = { fivemUrl: `http://127.0.0.1:${fakeFivem.address().port}`, syncKey: KEY, port: 0 };
    const game = new Game(config, () => {});
    const web = startServer(config, game, { discord: () => false }, () => {});
    await new Promise((resolve) => web.once('listening', resolve));
    const base = `http://127.0.0.1:${web.address().port}`;

    // health is public, the heartbeat is not
    assert.strictEqual((await fetch(`${base}/health`)).status, 200);
    assert.strictEqual((await fetch(`${base}/heartbeat`, { method: 'POST', body: '{}' })).status, 401);
    assert.strictEqual((await fetch(`${base}/heartbeat`, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer wrong-key-0123456789abcd' } })).status, 401);
    assert.strictEqual((await fetch(`${base}/nope`)).status, 404);

    // no heartbeat yet: falls back to the public endpoints, drops the phantom id 0, never keeps identifiers
    let state = await game.status();
    assert.strictEqual(state.source, 'poll');
    assert.strictEqual(state.players, 2);
    assert.strictEqual(state.max, 64);
    assert.ok(!JSON.stringify(state).includes('secret'), 'identifiers must never be kept');

    // a heartbeat wins over polling
    const beat = await fetch(`${base}/heartbeat`, {
        method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ players: 3, max: 64, staff: 1, aop: 'Blaine County', list: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }], priorities: [{ id: 'truck', label: 'Armored Truck', state: 'cooldown', remaining: 600 }] }),
    });
    assert.strictEqual(beat.status, 200);
    state = await game.status();
    assert.strictEqual(state.source, 'heartbeat');
    assert.strictEqual(state.players, 3);
    assert.strictEqual(state.aop, 'Blaine County');
    assert.strictEqual(state.priorities[0].label, 'Armored Truck');

    // role changes are batched into one authorised call
    calls.length = 0;
    game.queueSync('111111111111111111');
    game.queueSync('222222222222222222');
    game.queueSync('111111111111111111');
    await sleep(1900);
    const sync = calls.filter((c) => c.url === '/psrp_discord/sync');
    assert.strictEqual(sync.length, 1, 'one batched call');
    assert.strictEqual(sync[0].auth, `Bearer ${KEY}`);
    assert.deepStrictEqual(sync[0].body.discord.sort(), ['111111111111111111', '222222222222222222']);

    // an unreachable game server is reported, not thrown
    const dead = new Game({ fivemUrl: 'http://127.0.0.1:9', syncKey: KEY }, () => {});
    assert.strictEqual((await dead.syncNow(['1'])).ok, false);
    assert.strictEqual((await dead.status()).online, false);

    web.close();
    fakeFivem.close();
    console.log('smoke test passed');
    process.exit(0);
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
