// Checks the website file server: that it serves what it should, and refuses what it should.
// Run with: node test/static.js
const http = require('node:http');
const assert = require('node:assert');
const { serveStatic } = require('../src/static');

// Stands in for the real route table: everything the API would have matched is already past, and
// a miss falls through to the same JSON 404 the service uses.
const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"ok":true}');
    }
    if (serveStatic(req, res)) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
});

const get = (path) => new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
            status: res.statusCode,
            type: res.headers['content-type'] || '',
            body: Buffer.concat(chunks).toString('utf8'),
        }));
    });
});

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    let failed = 0;

    const check = async (path, expect, note) => {
        const res = await get(path);
        try {
            expect(res);
            console.log(`  ok    ${path.padEnd(34)} ${res.status} ${res.type.split(';')[0]}  ${note}`);
        } catch (err) {
            failed += 1;
            console.log(`  FAIL  ${path.padEnd(34)} ${res.status} ${res.type.split(';')[0]}  ${err.message}`);
        }
    };

    console.log('\nserves the site');
    await check('/', (r) => { assert.equal(r.status, 200); assert.match(r.type, /text\/html/); assert.match(r.body, /Palm Springs/); }, 'index at the root');
    await check('/index.html', (r) => assert.equal(r.status, 200), 'index by name');
    await check('/shop.html', (r) => { assert.equal(r.status, 200); assert.match(r.body, /Keep the city running/); }, 'store');
    await check('/products.html', (r) => assert.equal(r.status, 200), 'directory');
    await check('/shop', (r) => { assert.equal(r.status, 200); assert.match(r.type, /text\/html/); }, 'extensionless maps to .html');
    await check('/css/style.css', (r) => { assert.equal(r.status, 200); assert.match(r.type, /text\/css/); }, 'stylesheet, correct type');
    await check('/js/shop.js', (r) => { assert.equal(r.status, 200); assert.match(r.type, /text\/javascript/); }, 'script, correct type');
    await check('/img/logo.png', (r) => { assert.equal(r.status, 200); assert.match(r.type, /image\/png/); }, 'image');

    console.log('\nleaves the API alone');
    await check('/health', (r) => { assert.equal(r.status, 200); assert.match(r.type, /application\/json/); }, 'still JSON, not shadowed');

    console.log('\nrefuses what it should');
    const json404 = (r) => { assert.equal(r.status, 404); assert.match(r.type, /application\/json/); };
    await check('/../package.json', json404, 'traversal');
    await check('/..%2fpackage.json', json404, 'half-encoded traversal');
    await check('/%2e%2e%2fpackage.json', json404, 'fully encoded traversal');
    await check('/%2e%2e/%2e%2e/etc/passwd', json404, 'nested encoded traversal');
    await check('/css/../../package.json', json404, 'traversal out of a real directory');
    await check('/.gitignore', json404, 'dotfile');
    await check('/missing.js', json404, 'missing asset does NOT fall back to html');
    await check('/missing.css', json404, 'same for stylesheets');
    await check('/nope/deep/missing', json404, 'unknown extensionless path');
    await check('/package.json', json404, 'file outside public, by name');

    server.close();
    console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
    process.exit(failed ? 1 : 0);
})();
