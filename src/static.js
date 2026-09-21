// Serves the public website from public/, so psrpnetwork.online shows the server's page instead of
// this service's JSON. It runs LAST in the route table, after every API route, so nothing it does
// can shadow /health or the keyed POST endpoints.
//
// This turns a private API into a publicly reachable file server, so the path handling below is
// deliberately strict rather than convenient. Every rule has a reason written next to it.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', 'public');

// An allowlist, not a guess. Anything not named here is not served at all, so a stray .env, .bak or
// .map in public/ cannot be fetched even if someone copies one in by mistake.
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

// Decode BEFORE inspecting. A traversal check that runs on the raw request string is the classic
// bypass: %2e%2e%2f survives it untouched and becomes ../ the moment anything decodes the path.
function safePath(urlPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch {
        return null; // malformed percent-encoding
    }
    if (decoded.includes('\0')) return null;
    if (decoded.includes('\\')) return null; // backslash is a separator on Windows
    if (/(^|\/)\.\.(\/|$)/.test(decoded)) return null;
    // no dotfiles or dot-directories: .git, .env and friends are never web content
    if (decoded.split('/').some((seg) => seg.startsWith('.'))) return null;
    return decoded.replace(/^\/+/, '');
}

// Must be a real file inside ROOT. lstat rather than stat, so a symlink pointing out of public/ is
// refused instead of followed.
function realFile(full) {
    if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return false; // prefix check on the RESOLVED path
    try {
        return fs.lstatSync(full).isFile();
    } catch {
        return false;
    }
}

// Returns the file to serve, or null to let the caller fall through to its JSON 404.
function pick(rel) {
    if (rel === '') {
        const index = path.resolve(ROOT, 'index.html');
        return realFile(index) ? index : null;
    }

    const direct = path.resolve(ROOT, rel);
    if (realFile(direct) && TYPES[path.extname(direct).toLowerCase()]) return direct;

    // An explicit extension that is missing stays missing. Serving index.html for a 404'd .js with
    // a 200 is how you spend an hour debugging a "syntax error" that is really a doctype.
    if (path.extname(rel)) return null;

    for (const candidate of [`${rel}.html`, path.join(rel, 'index.html')]) {
        const full = path.resolve(ROOT, candidate);
        if (realFile(full)) return full;
    }
    return null;
}

// Returns true when it has answered the request, false to let the caller continue.
// Sets headers only on this response. It must never touch shared or global headers, or the CORS
// header meant for /health would leak onto the keyed POST endpoints.
function serveStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    const rel = safePath((req.url || '/').split('?')[0]);
    if (rel === null) return false;

    const file = pick(rel);
    if (!file) return false;

    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext];
    if (!type) return false;

    let body;
    try {
        body = fs.readFileSync(file);
    } catch {
        return false;
    }

    res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': body.length,
        // HTML is re-fetched so a copy change shows up without a hard refresh; the assets beside it
        // can sit in cache, and they are versioned by redeploy anyway.
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
}

module.exports = { serveStatic, ROOT, TYPES };
