/* Palm Springs Roleplay store, front end only.
   There is no payment path here and no server behind it. The cart lives in this browser and
   nothing leaves the page. When real products exist, replace PRODUCTS below with whatever the
   backend serves: everything downstream reads from that one array. */
(() => {
    'use strict';

    // =========================================================================================
    // PLACEHOLDER PRODUCTS. Nothing here is decided. Prices are invented.
    // This list is only a starting shape for the grid. Add, remove or reprice freely: the
    // filters, cart and totals all read from it, and nothing downstream assumes a category.
    // =========================================================================================
    const PRODUCTS = [
        { id: 'sup-1m',   cat: 'supporter', name: 'Supporter, 1 month',   price: 8,  icon: 'star',
          blurb: 'Coloured name in Discord, a supporter tag in game, and queue priority while it lasts.' },
        { id: 'sup-3m',   cat: 'supporter', name: 'Supporter, 3 months',  price: 21, icon: 'star', tag: 'Best value', feat: true,
          blurb: 'The same as above, billed once and cheaper per month.' },
        { id: 'sup-life', cat: 'supporter', name: 'Supporter, lifetime',  price: 60, icon: 'star',
          blurb: 'One payment, kept for as long as the server runs.' },

        { id: 'queue-30', cat: 'supporter', name: 'Priority queue, 30 days', price: 6, icon: 'queue', tag: 'Popular', feat: true,
          blurb: 'Skip ahead in the connection queue on a busy night.' },

        { id: 'slot-1',   cat: 'character', name: 'Extra character slot',  price: 10, icon: 'user',
          blurb: 'A fourth character on your account, kept permanently.' },
        { id: 'rename',   cat: 'character', name: 'Character rename',      price: 4,  icon: 'user',
          blurb: 'Change a character name once without losing anything they own.' },

        { id: 'plate',    cat: 'cosmetic',  name: 'Custom licence plate',  price: 5,  icon: 'plate',
          blurb: 'Pick your own plate text, subject to staff approval.' },
        { id: 'clothes',  cat: 'cosmetic',  name: 'Clothing bundle',       price: 9,  icon: 'shirt',
          blurb: 'A set of custom outfits added to your character wardrobe.' },
        { id: 'tattoo',   cat: 'cosmetic',  name: 'Tattoo pack',           price: 7,  icon: 'shirt',
          blurb: 'Custom tattoo designs, applied at any tattoo parlour in the city.' },

        { id: 'livery',   cat: 'vehicle',   name: 'Custom vehicle livery', price: 12, icon: 'car', feat: true,
          blurb: 'Your own paint design on a vehicle you already own.' },
        { id: 'plate-veh',cat: 'vehicle',   name: 'Vehicle cosmetic kit',  price: 15, icon: 'car',
          blurb: 'Wheels, tint and a body kit of your choosing.' },
    ];

    const CATEGORIES = [
        { id: 'all',       label: 'Everything' },
        { id: 'supporter', label: 'Supporter' },
        { id: 'cosmetic',  label: 'Cosmetics' },
        { id: 'vehicle',   label: 'Vehicles' },
        { id: 'character', label: 'Character' },
    ];

    const ICONS = {
        star:  '<path d="M12 3.2l2.6 5.5 6 .9-4.3 4.3 1 6.1-5.3-2.9-5.3 2.9 1-6.1L3.4 9.6l6-.9z"/>',
        queue: '<path d="M4 7h16M4 12h10M4 17h6"/><path d="M17.5 14.5l3 2.5-3 2.5"/>',
        user:  '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
        plate: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11.5h2M11 11.5h6M7 14h10"/>',
        shirt: '<path d="M9 4l3 2 3-2 5 2.5-1.8 4L16 10v9.5H8V10l-2.2.5L4 6.5z"/>',
        car:   '<path d="M5 12l1.6-4.2A2 2 0 0 1 8.5 6.5h7a2 2 0 0 1 1.9 1.3L19 12m-14 0h14m-14 0v4.5M19 12v4.5M7 16.5h10"/><circle cx="8" cy="17.5" r="1.3"/><circle cx="16" cy="17.5" r="1.3"/>',
    };

    const CART_KEY = 'psrp.cart.v1';

    const $ = (s) => document.querySelector(s);
    const money = (n) => `$${n.toFixed(2)}`;
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const el = {
        filters: $('#filters'), products: $('#products'), count: $('#result-count'),
        emptyNote: $('#empty-note'),
        cart: $('#cart'), veil: $('#cart-veil'), list: $('#cart-list'), cartEmpty: $('#cart-empty'),
        total: $('#cart-total'), badge: $('#cart-count'), checkout: $('#checkout'),
        open: $('#cart-open'), close: $('#cart-close'),
    };
    if (!el.products) return;


    // =========================================================================================
    // DISCORD SIGN IN
    //
    // READ THIS BEFORE WIRING PAYMENTS. What follows IDENTIFIES a visitor. It does not
    // AUTHORISE anything. It all runs in the browser, so anyone can set the same state by hand
    // in devtools. That is acceptable today only because checkout cannot take money. The moment
    // a real payment path exists, the server must verify the Discord identity itself, from its
    // own OAuth exchange, and must never trust what this page tells it about who is buying.
    //
    // To switch it on, make a Discord application at discord.com/developers, add this page's
    // URL as a redirect, and fill in the two values below. Until then the button says so.
    // =========================================================================================
    const AUTH = {
        clientId: '',                                   // Discord application client id
        redirectUri: location.origin + location.pathname,
        scope: 'identify',
    };
    const SESSION_KEY = 'psrp.user.v1';
    const STATE_KEY = 'psrp.oauth.state';

    const store = {
        get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
        set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
        del(k) { try { sessionStorage.removeItem(k); } catch { /* not fatal */ } },
    };

    let user = store.get(SESSION_KEY);

    function startLogin() {
        if (!AUTH.clientId) {
            toastShop('Discord sign in is not configured yet.');
            return;
        }
        // a random state, checked on the way back, so another site cannot hand us a response
        const state = [...crypto.getRandomValues(new Uint8Array(16))]
            .map((b) => b.toString(16).padStart(2, '0')).join('');
        store.set(STATE_KEY, state);
        const q = new URLSearchParams({
            client_id: AUTH.clientId,
            redirect_uri: AUTH.redirectUri,
            response_type: 'token',
            scope: AUTH.scope,
            state,
        });
        location.href = `https://discord.com/api/oauth2/authorize?${q}`;
    }

    function logout() {
        user = null;
        store.del(SESSION_KEY);
        renderAuth();
        renderCart();
    }

    // Discord returns the token in the URL fragment. We spend it once for the profile and then
    // throw it away: it is never stored, so a stolen session file cannot be replayed.
    async function completeLogin() {
        if (!location.hash.includes('access_token')) return;
        const got = new URLSearchParams(location.hash.slice(1));
        history.replaceState(null, '', location.pathname + location.search);

        const expected = store.get(STATE_KEY);
        store.del(STATE_KEY);
        if (!expected || got.get('state') !== expected) {
            toastShop('Sign in could not be verified. Please try again.');
            return;
        }
        try {
            const res = await fetch('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${got.get('access_token')}` },
            });
            if (!res.ok) throw new Error(res.status);
            const me = await res.json();
            user = { id: me.id, name: me.global_name || me.username, avatar: me.avatar };
            store.set(SESSION_KEY, user);
            renderAuth();
            renderCart();
        } catch {
            toastShop('Discord did not return your account. Please try again.');
        }
    }

    function renderAuth() {
        const btn = $('#login-btn');
        const label = $('#login-label');
        if (!btn || !label) return;
        label.textContent = user ? user.name : 'Log in';
        btn.title = user ? 'Sign out' : 'Sign in with Discord';
        btn.classList.toggle('signed-in', !!user);
    }

    const loginBtn = $('#login-btn');
    if (loginBtn) loginBtn.addEventListener('click', () => (user ? logout() : startLogin()));

    let shopToast;
    function toastShop(message) {
        if (!shopToast) {
            shopToast = document.createElement('div');
            shopToast.setAttribute('role', 'status');
            shopToast.style.cssText =
                'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:300;' +
                'padding:.8em 1.3em;border-radius:10px;background:#101512;color:#e8ede9;' +
                'border:1px solid rgba(61,255,110,.32);font-family:inherit;font-size:.92rem;' +
                'box-shadow:0 14px 40px -12px rgba(0,0,0,.8);opacity:0;transition:opacity .2s';
            document.body.appendChild(shopToast);
        }
        shopToast.textContent = message;
        requestAnimationFrame(() => { shopToast.style.opacity = '1'; });
        clearTimeout(toastShop._t);
        toastShop._t = setTimeout(() => { shopToast.style.opacity = '0'; }, 3400);
    }

    // ---- cart state -------------------------------------------------------------------------
    // Browser storage can throw in private mode, so every read and write is guarded and the page
    // works fine without it; the cart just does not survive a reload.
    let cart = {};
    try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { cart = {}; }
    const save = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* not fatal */ } };
    const byId = (id) => PRODUCTS.find((p) => p.id === id);

    // ---- catalogue --------------------------------------------------------------------------
    // The landing page shows a short featured row and has no filters; the directory has a search
    // box and a category list down the side. Same renderer, told apart by which markup exists.
    const isDirectory = !!$('#side-cats');
    let active = 'all';
    let query = '';

    const matches = (p) => {
        if (active !== 'all' && p.cat !== active) return false;
        if (!query) return true;
        return `${p.name} ${p.blurb}`.toLowerCase().includes(query);
    };

    const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || {}).label || id;
    const countIn = (id) => (id === 'all' ? PRODUCTS.length : PRODUCTS.filter((p) => p.cat === id).length);

    function renderSide() {
        const side = $('#side-cats');
        if (!side) return;
        side.innerHTML = CATEGORIES.map((c) => `
            <li><button class="side-cat" type="button" data-cat="${c.id}"
                        aria-current="${c.id === active ? 'true' : 'false'}">
                <span>${esc(c.label)}</span><em>${countIn(c.id)}</em>
            </button></li>`).join('');
    }

    function renderProducts() {
        const list = isDirectory
            ? PRODUCTS.filter(matches)
            : PRODUCTS.filter((p) => p.feat);

        el.products.innerHTML = list.map((p) => `
            <article class="product">
                <div class="product-thumb">
                    ${p.tag ? `<span class="product-tag${p.tag === 'Best value' ? ' alt' : ''}">${esc(p.tag)}</span>` : ''}
                    <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[p.icon] || ICONS.star}</svg>
                </div>
                <div class="product-body">
                    <h3>${esc(p.name)}</h3>
                    <p class="product-blurb">${esc(p.blurb)}</p>
                    <div class="product-foot">
                        <span class="chip">${esc(catLabel(p.cat))}</span>
                        <span class="price"><b>${money(p.price)}</b></span>
                    </div>
                    <button class="add" type="button" data-add="${p.id}">Add to cart</button>
                </div>
            </article>`).join('');

        if (el.emptyNote) el.emptyNote.hidden = list.length > 0;
        const sub = $('#dir-sub');
        if (sub) {
            sub.textContent = query || active !== 'all'
                ? `${list.length} of ${PRODUCTS.length} items`
                : `Browse all ${PRODUCTS.length} items`;
        }
    }

    const side = $('#side-cats');
    if (side) {
        side.addEventListener('click', (e) => {
            const b = e.target.closest('[data-cat]');
            if (!b) return;
            active = b.dataset.cat;
            renderSide();
            renderProducts();
        });
    }

    const search = $('#search');
    if (search) {
        let t;
        search.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => { query = search.value.trim().toLowerCase(); renderProducts(); }, 140);
        });
    }

    // the featured banner's button lives outside the grid, so listen at document level
    document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-add]');
        if (!b) return;
        add(b.dataset.add);
        const label = b.textContent;
        b.textContent = 'Added';
        b.classList.add('added');
        setTimeout(() => { b.textContent = label; b.classList.remove('added'); }, 1200);
    });

    // ---- cart -------------------------------------------------------------------------------
    function add(id) {
        if (!byId(id)) return;
        cart[id] = (cart[id] || 0) + 1;
        save();
        renderCart();
    }

    function setQty(id, qty) {
        if (qty <= 0) delete cart[id];
        else cart[id] = Math.min(qty, 99);
        save();
        renderCart();
    }

    function renderCart() {
        const entries = Object.entries(cart).filter(([id]) => byId(id));
        const units = entries.reduce((n, [, q]) => n + q, 0);
        const total = entries.reduce((n, [id, q]) => n + byId(id).price * q, 0);

        el.badge.hidden = units === 0;
        el.badge.textContent = String(units);
        el.cartEmpty.hidden = units > 0;
        el.total.textContent = money(total);

        // empty cart disables it; a full cart with no Discord account turns it into the sign-in step
        const note = $('.cart-note');
        if (!user) {
            el.checkout.disabled = units === 0;
            el.checkout.textContent = 'Sign in with Discord';
            if (note) note.textContent = 'You need to sign in with Discord before checking out.';
        } else {
            el.checkout.disabled = units === 0;
            el.checkout.textContent = 'Checkout';
            if (note) note.textContent = 'Signed in as ' + user.name + '. Checkout is not connected yet, so nothing on this page can take a payment.';
        }

        el.list.innerHTML = entries.map(([id, q]) => {
            const p = byId(id);
            return `
            <li class="cart-item">
                <h3>${esc(p.name)}</h3>
                <span class="line-price">${money(p.price * q)}</span>
                <div class="qty">
                    <button type="button" data-qty="${p.id}" data-d="-1" aria-label="One fewer ${esc(p.name)}">&minus;</button>
                    <span>${q}</span>
                    <button type="button" data-qty="${p.id}" data-d="1" aria-label="One more ${esc(p.name)}">+</button>
                </div>
                <button class="cart-remove" type="button" data-remove="${p.id}">Remove</button>
            </li>`;
        }).join('');
    }

    el.list.addEventListener('click', (e) => {
        const step = e.target.closest('[data-qty]');
        if (step) return setQty(step.dataset.qty, (cart[step.dataset.qty] || 0) + Number(step.dataset.d));
        const rm = e.target.closest('[data-remove]');
        if (rm) setQty(rm.dataset.remove, 0);
    });

    // ---- drawer ------------------------------------------------------------------------------
    let lastFocus = null;
    function openCart() {
        lastFocus = document.activeElement;
        el.veil.hidden = false;
        requestAnimationFrame(() => el.veil.classList.add('show'));
        el.cart.classList.add('open');
        el.cart.setAttribute('aria-hidden', 'false');
        el.close.focus();
    }
    function closeCart() {
        el.veil.classList.remove('show');
        setTimeout(() => { el.veil.hidden = true; }, 220);
        el.cart.classList.remove('open');
        el.cart.setAttribute('aria-hidden', 'true');
        if (lastFocus) lastFocus.focus();
    }
    el.open.addEventListener('click', openCart);
    el.close.addEventListener('click', closeCart);
    el.veil.addEventListener('click', closeCart);
    addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && el.cart.classList.contains('open')) closeCart();
    });

    // Checkout is deliberately inert. It is disabled while empty, and says so when it is not,
    // rather than pretending to start a purchase that cannot happen.
    el.checkout.addEventListener('click', () => {
        if (!user) return startLogin();
        el.checkout.textContent = 'Not connected yet';
        setTimeout(() => { el.checkout.textContent = 'Checkout'; }, 1800);
    });

    renderAuth();
    completeLogin();

    const browse = $('#browse-label');
    if (browse) browse.textContent = `Browse all ${PRODUCTS.length} items`;

    renderSide();
    renderProducts();
    renderCart();
})();
