/* Palm Springs Roleplay site behaviour.
   Everything here is progressive: the page is fully readable and usable with JS disabled or the
   status API unreachable. Nothing below is required to connect to the server. */
(() => {
    'use strict';

    // ---- fill these in ---------------------------------------------------------------------
    const CONFIG = {
        discord: '',                                                   // e.g. 'https://discord.gg/xxxxxxx'
        store: '',                                                     // e.g. 'https://psrpnetwork.online/store'
        serverIp: '23.27.211.21:30136',
        // The service that serves this site also serves /health, so in production this is
        // same-origin and does not depend on CORS at all. Only the local preview, which runs on a
        // different port from the API, needs the absolute URL.
        statusApi: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
            ? 'https://psrp-everglades2-3dbd9952.koyeb.app/health'
            : '/health',
    };

    const $ = (s) => document.querySelector(s);
    const $$ = (s) => [...document.querySelectorAll(s)];

    // ---- nav ------------------------------------------------------------------------------
    const nav = $('#nav');
    const onScroll = () => nav.classList.toggle('stuck', window.scrollY > 12);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });

    const burger = $('#burger');
    const menu = $('#menu');
    const setMenu = (open) => {
        menu.classList.toggle('open', open);
        burger.setAttribute('aria-expanded', String(open));
        burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    burger.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

    // ---- external links --------------------------------------------------------------------
    // Until a real URL is configured these must not look clickable-but-dead, so they say so.
    const wire = (selector, url, label) => {
        $$(selector).forEach((el) => {
            if (url) {
                el.setAttribute('href', url);
                el.setAttribute('target', '_blank');
                el.setAttribute('rel', 'noopener noreferrer');
                return;
            }
            el.addEventListener('click', (e) => {
                e.preventDefault();
                toast(`${label} link is not set up yet.`);
            });
        });
    };
    wire('[data-discord]', CONFIG.discord, 'Discord');
    wire('[data-store]', CONFIG.store, 'Store');

    // ---- copy IP ---------------------------------------------------------------------------
    const copyIp = async (btn) => {
        const original = btn.textContent;
        try {
            await navigator.clipboard.writeText(CONFIG.serverIp);
            btn.textContent = 'Copied';
        } catch {
            // clipboard is blocked on insecure origins and in some browsers
            toast(`Server IP: ${CONFIG.serverIp}`);
            return;
        }
        setTimeout(() => { btn.textContent = original; }, 1600);
    };
    ['#copy-ip', '#copy-ip-2'].forEach((id) => {
        const b = $(id);
        if (b) b.addEventListener('click', () => copyIp(b));
    });

    // ---- toast ------------------------------------------------------------------------------
    let toastEl;
    function toast(message) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.setAttribute('role', 'status');
            toastEl.style.cssText =
                'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:300;' +
                'padding:.8em 1.3em;border-radius:10px;background:#101512;color:#e8ede9;' +
                'border:1px solid rgba(61,255,110,.32);font-family:inherit;font-size:.92rem;' +
                'box-shadow:0 14px 40px -12px rgba(0,0,0,.8);opacity:0;transition:opacity .2s';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = message;
        requestAnimationFrame(() => { toastEl.style.opacity = '1'; });
        clearTimeout(toast._t);
        toast._t = setTimeout(() => { toastEl.style.opacity = '0'; }, 3200);
    }

    // ---- live status ------------------------------------------------------------------------
    // Failure is expected and silent to the visitor: the strip falls back to just the IP rather
    // than claiming the server is down, because a fetch failure says nothing about the server.
    const status = $('#status');
    const statusText = $('#status-text');

    // The count comes from the game via a heartbeat every 60s. If the last beat is old the number
    // is history, not news, so it is not shown at all rather than shown as if it were live.
    const STALE_AFTER = 210;   // seconds, three missed beats

    async function refreshStatus() {
        if (!CONFIG.statusApi) return fallback();
        try {
            const res = await fetch(CONFIG.statusApi, { cache: 'no-store' });
            if (!res.ok) throw new Error(res.status);
            const d = await res.json();

            const age = d.heartbeatAge;
            const known = typeof age === 'number' && Number.isFinite(age);
            const fresh = known && age <= STALE_AFTER;

            if (d.game === false) {
                status.dataset.state = 'offline';
                statusText.textContent = 'Server is restarting';
                return;
            }
            if (!fresh) return fallback();   // reachable, but nothing recent to report

            const n = Math.max(0, Number(d.players) || 0);
            status.dataset.state = 'online';
            statusText.textContent = n === 1 ? '1 player in the city' : `${n} players in the city`;
            if (d.aop) statusText.textContent += ` · AOP ${d.aop}`;
        } catch {
            fallback();
        }
    }

    function fallback() {
        status.dataset.state = 'unknown';
        statusText.textContent = 'Direct connect';
    }

    if (status && statusText) {
        refreshStatus();
        setInterval(refreshStatus, 60000);
    }

    // ---- count-up ---------------------------------------------------------------------------
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                io.unobserve(entry.target);
                const el = entry.target;
                const target = Number(el.dataset.count);
                const label = el.textContent;
                if (!Number.isFinite(target) || target <= 0) return;   // "24/7" and "Zero" stay as written
                const started = performance.now();
                const tick = (now) => {
                    const p = Math.min((now - started) / 900, 1);
                    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
                    if (p < 1) requestAnimationFrame(tick);
                    else el.textContent = label;
                };
                requestAnimationFrame(tick);
            });
        }, { threshold: .4 });
        $$('.stats b[data-count]').forEach((el) => io.observe(el));
    }

    // ---- year --------------------------------------------------------------------------------
    const year = $('#year');
    if (year) year.textContent = `© ${new Date().getFullYear()} Palm Springs Roleplay.`;
})();
