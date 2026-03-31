/**
 * FXAPWORLD payment API — deploy separately from GitHub Pages (Render, Railway, Fly.io, VPS).
 *
 * Stripe Dashboard → Webhooks → Endpoint URL must be YOUR API:
 *   https://YOUR-HOST/api/webhook
 * (NOT a Discord URL — Discord is notified via DISCORD_PURCHASE_WEBHOOK_URL below.)
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FRONTEND_URL,
 *       DISCORD_PURCHASE_WEBHOOK_URL (optional staff notifications)
 * Catalog publish: ADMIN_ACCESS_KEY (match config.js admin.accessKey), GITHUB_TOKEN,
 *       GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, GITHUB_CATALOG_PATH, CORS_ORIGINS (optional)
 * Post-purchase: SMTP_USER, SMTP_PASS (Gmail app password), optional MAIL_FROM, SMTP_HOST, SMTP_PORT
 *       DISCORD_CUSTOMER_ROLE_ID (default 1488313041442574367), CATALOG_URL (optional override for products.json)
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const fetch = require('node-fetch');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;

const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
let FRONTEND_ORIGIN = null;
try {
    if (FRONTEND_URL) FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin;
} catch (e) {
    console.warn('Invalid FRONTEND_URL', e.message);
}
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_MODE = (process.env.PAYPAL_MODE || 'live').toLowerCase() === 'sandbox' ? 'sandbox' : 'live';
const PAYPAL_API = PAYPAL_MODE === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_PURCHASE_WEBHOOK_URL = process.env.DISCORD_PURCHASE_WEBHOOK_URL;
/** Assigned after successful Stripe checkout when buyer signed in with Discord */
const DISCORD_CUSTOMER_ROLE_ID = process.env.DISCORD_CUSTOMER_ROLE_ID || '1488313041442574367';

const nodemailer = require('nodemailer');
let mailTransporter = null;
function getMailTransporter() {
    if (mailTransporter) return mailTransporter;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) return null;
    mailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user, pass }
    });
    return mailTransporter;
}

const ADMIN_ACCESS_KEY = process.env.ADMIN_ACCESS_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'fxapworld';
const GITHUB_REPO = process.env.GITHUB_REPO || 'RTX';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_CATALOG_PATH = process.env.GITHUB_CATALOG_PATH || 'products.json';
const CORS_EXTRA = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const app = express();

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (FRONTEND_ORIGIN && origin === FRONTEND_ORIGIN) return cb(null, true);
        if (CORS_EXTRA.includes(origin)) return cb(null, true);
        if (!FRONTEND_ORIGIN && CORS_EXTRA.length === 0) return cb(null, true);
        return cb(null, false);
    },
    credentials: true
}));

app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe) return res.status(503).send('Stripe not configured');

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        let session = event.data.object;
        try {
            session = await stripe.checkout.sessions.retrieve(session.id);
        } catch (e) {
            console.error('checkout.sessions.retrieve failed', e.message);
        }
        let items = [];
        try {
            if (session.metadata && session.metadata.items) {
                items = JSON.parse(session.metadata.items);
            }
        } catch (e) {
            console.error('metadata.items parse', e);
        }
        const userId = session.metadata && session.metadata.userId;
        await notifyPurchaseToDiscordWebhook(session, items);
        await processOrder(session, userId, items);
    }

    res.json({ received: true });
});

app.use(express.json());

const githubHeaders = () => ({
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
});

app.post('/api/catalog/save', async (req, res) => {
    const key = req.headers['x-admin-key'];
    if (!ADMIN_ACCESS_KEY || key !== ADMIN_ACCESS_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!GITHUB_TOKEN) {
        return res.status(503).json({ error: 'GITHUB_TOKEN not set on server' });
    }

    const { products } = req.body;
    if (!Array.isArray(products)) {
        return res.status(400).json({ error: 'Body must include products array' });
    }

    const content = JSON.stringify({ products }, null, 2);
    const base64 = Buffer.from(content, 'utf8').toString('base64');
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(GITHUB_CATALOG_PATH)}`;

    try {
        const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
            headers: githubHeaders()
        });

        let sha = null;
        if (getRes.status === 404) {
            sha = null;
        } else if (!getRes.ok) {
            const t = await getRes.text();
            console.error('GitHub GET products.json', getRes.status, t);
            return res.status(500).json({ error: 'GitHub read failed', details: t.slice(0, 500) });
        } else {
            const file = await getRes.json();
            sha = file.sha;
        }

        const putBody = {
            message: `catalog: update via admin (${new Date().toISOString()})`,
            content: base64,
            branch: GITHUB_BRANCH
        };
        if (sha) putBody.sha = sha;

        const putRes = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                ...githubHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(putBody)
        });

        if (!putRes.ok) {
            const t = await putRes.text();
            console.error('GitHub PUT products.json', putRes.status, t);
            return res.status(500).json({ error: 'GitHub commit failed', details: t.slice(0, 500) });
        }

        const result = await putRes.json();
        res.json({
            success: true,
            commit: result.commit && result.commit.sha,
            url: result.content && result.content.html_url
        });
    } catch (e) {
        console.error('catalog/save', e);
        res.status(500).json({ error: e.message || 'Server error' });
    }
});

app.post('/api/create-checkout-session', async (req, res) => {
    if (!stripe) {
        return res.status(503).json({ error: 'Stripe is not configured (missing STRIPE_SECRET_KEY)' });
    }
    if (!FRONTEND_URL) {
        return res.status(500).json({ error: 'FRONTEND_URL is not set on the server' });
    }

    try {
        const { items, userId, username } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No items in cart' });
        }

        const line_items = items.map((item) => ({
            price_data: {
                currency: 'usd',
                product_data: {
                    name: item.name || 'FXAPWORLD item',
                    metadata: { product_id: String(item.id || '') }
                },
                unit_amount: Math.round(Number(item.price) * 100)
            },
            quantity: 1
        }));

        const compactItems = items.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            u: i.downloadUrl || ''
        }));
        let itemsJson = JSON.stringify(compactItems);
        if (itemsJson.length > 450) {
            itemsJson = JSON.stringify(items.map((i) => i.id));
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items,
            success_url: `${FRONTEND_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/?checkout=cancel`,
            metadata: {
                userId: userId || '',
                username: username || '',
                items: itemsJson
            },
            customer_email: undefined,
            automatic_tax: { enabled: false }
        });

        res.json({ url: session.url, id: session.id });
    } catch (error) {
        console.error('create-checkout-session', error);
        res.status(500).json({ error: error.message || 'Failed to create session' });
    }
});

async function paypalAccessToken() {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    const data = await res.json();
    if (!data.access_token) {
        throw new Error(data.error_description || 'PayPal auth failed');
    }
    return data.access_token;
}

app.post('/api/paypal/create-order', async (req, res) => {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        return res.status(503).json({ error: 'PayPal is not configured on the server' });
    }

    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No items' });
        }

        const total = items.reduce((s, i) => s + Number(i.price || 0), 0);
        const token = await paypalAccessToken();

        const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        amount: {
                            currency_code: 'USD',
                            value: total.toFixed(2)
                        },
                        description: 'FXAPWORLD marketplace order',
                        custom_id: JSON.stringify(items.map((i) => ({ id: i.id, name: i.name })))
                    }
                ]
            })
        });

        const order = await orderRes.json();
        if (!orderRes.ok) {
            console.error('PayPal create order', order);
            return res.status(400).json({ error: order.message || 'PayPal order failed' });
        }

        res.json({ id: order.id });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message || 'PayPal error' });
    }
});

app.post('/api/paypal/capture-order', async (req, res) => {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        return res.status(503).json({ error: 'PayPal not configured' });
    }

    try {
        const { orderID } = req.body;
        if (!orderID) return res.status(400).json({ error: 'Missing orderID' });

        const token = await paypalAccessToken();
        const capRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await capRes.json();
        if (!capRes.ok || data.status !== 'COMPLETED') {
            console.error('PayPal capture', data);
            return res.status(400).json({ error: data.message || 'Capture failed', details: data });
        }

        res.json({ success: true, order: data });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message || 'Capture error' });
    }
});

app.post('/api/create-payment-intent', async (req, res) => {
    if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
    try {
        const { amount, items, userId } = req.body;
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100),
            currency: 'usd',
            metadata: {
                userId: userId || '',
                items: JSON.stringify(items || [])
            }
        });
        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create payment intent' });
    }
});

/** Discord sometimes returns HTML (proxy/502) — never assume JSON on errors */
async function discordResponseInfo(response) {
    const text = await response.text();
    let json = null;
    if (text) {
        try {
            json = JSON.parse(text);
        } catch (_) {
            /* not JSON (e.g. <!doctype html>) */
        }
    }
    return { text, json };
}

app.post('/api/discord/join', async (req, res) => {
    try {
        if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
            return res.status(503).json({ success: false, error: 'Discord bot not configured on server' });
        }
        const { userId, accessToken } = req.body;
        if (!userId || !accessToken) {
            return res.status(400).json({ success: false, error: 'Missing userId or accessToken' });
        }
        const response = await fetch(
            `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${userId}`,
            {
                method: 'PUT',
                headers: {
                    Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ access_token: accessToken })
            }
        );

        if (response.ok) {
            return res.json({ success: true, message: 'Successfully joined Discord server' });
        }
        const { text, json } = await discordResponseInfo(response);
        const msg =
            json && json.message
                ? json.message
                : `Discord HTTP ${response.status}${text && text.startsWith('<') ? ' (HTML error page — check bot token & guild id)' : ''}`;
        console.error('Discord join failed', response.status, json || text.slice(0, 400));
        res.status(400).json({ success: false, error: msg });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to join Discord server' });
    }
});

function formatItemLine(item) {
    if (typeof item === 'string') return `• \`${item}\``;
    if (item && item.name) return `• **${item.name}** — $${Number(item.price).toFixed(2)}`;
    return JSON.stringify(item);
}

async function notifyPurchaseToDiscordWebhook(session, items) {
    if (!DISCORD_PURCHASE_WEBHOOK_URL) return;

    const total =
        session.amount_total != null ? (session.amount_total / 100).toFixed(2) : '?';
    const currency = (session.currency || 'usd').toUpperCase();
    const email =
        (session.customer_details && session.customer_details.email) ||
        session.customer_email ||
        '—';
    const username = (session.metadata && session.metadata.username) || '—';
    const discordUserId = (session.metadata && session.metadata.userId) || '';

    let itemLines =
        Array.isArray(items) && items.length
            ? items.map(formatItemLine).join('\n')
            : '_Line items not in metadata — check Stripe._';
    if (itemLines.length > 1020) itemLines = itemLines.slice(0, 1017) + '…';

    const embed = {
        title: 'New FXAPWORLD purchase',
        description: `Stripe Checkout completed.`,
        color: 0xff2d95,
        fields: [
            { name: 'Amount', value: `${currency} ${total}`, inline: true },
            { name: 'Session', value: `\`${session.id}\``, inline: true },
            { name: 'Buyer email', value: String(email).slice(0, 1024), inline: false },
            {
                name: 'Discord buyer',
                value: String(
                    username +
                        (discordUserId ? ` (\`${discordUserId}\`)` : '') +
                        (discordUserId ? '' : '\n_(not logged in on site)_')
                ).slice(0, 1024),
                inline: false
            },
            { name: 'Items', value: itemLines || '—', inline: false }
        ],
        timestamp: new Date().toISOString()
    };

    try {
        const r = await fetch(DISCORD_PURCHASE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [embed],
                username: 'FXAPWORLD purchases'
            })
        });
        if (!r.ok) {
            const t = await r.text();
            console.error('Discord webhook failed', r.status, t);
        }
    } catch (e) {
        console.error('notifyPurchaseToDiscordWebhook', e);
    }
}

function normalizeMetaItem(item) {
    if (typeof item === 'string') {
        return { id: item, name: item, price: null, downloadUrl: null };
    }
    return {
        id: String(item.id || ''),
        name: item.name || item.id,
        price: item.price,
        downloadUrl: item.u || item.downloadUrl || null
    };
}

async function fetchCatalogProducts() {
    const base = (process.env.CATALOG_URL || (FRONTEND_URL ? `${FRONTEND_URL}/products.json` : '')).trim();
    if (!base) throw new Error('FRONTEND_URL or CATALOG_URL required for catalog');
    const res = await fetch(base);
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    return res.json();
}

async function enrichItemsWithDownloads(rawItems) {
    const normalized = rawItems.map(normalizeMetaItem);
    let catalogById = {};
    const needCatalog = normalized.some((it) => !it.downloadUrl);
    if (needCatalog) {
        try {
            const data = await fetchCatalogProducts();
            const list = data.products || [];
            catalogById = Object.fromEntries(list.map((p) => [p.id, p]));
        } catch (e) {
            console.error('enrichItemsWithDownloads catalog fetch', e.message);
        }
    }
    return normalized.map((it) => {
        const p = catalogById[it.id];
        const downloadUrl = it.downloadUrl || (p && p.downloadUrl) || null;
        const name = (p && p.name) || it.name;
        const price = it.price != null ? it.price : p && p.price;
        return { id: it.id, name, price, downloadUrl };
    });
}

function escapeHtmlText(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function sendPurchaseEmail(to, enrichedItems, sessionId) {
    const transport = getMailTransporter();
    if (!to) {
        console.warn('sendPurchaseEmail: no recipient email');
        return;
    }
    if (!transport) {
        console.warn('sendPurchaseEmail: set SMTP_USER and SMTP_PASS on Render (Gmail app password) to email download links');
        return;
    }

    const fromAddr = process.env.MAIL_FROM || `FXAPWORLD <${process.env.SMTP_USER}>`;
    const listHtml = enrichedItems
        .map((it) => {
            const name = escapeHtmlText(it.name);
            if (it.downloadUrl && /^https?:\/\//i.test(it.downloadUrl)) {
                const u = escapeHtmlText(it.downloadUrl);
                return `<li><strong>${name}</strong><br><a href="${u}">${u}</a></li>`;
            }
            return `<li><strong>${name}</strong> — link will be sent by support if missing.</li>`;
        })
        .join('');

    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#111;color:#eee;padding:16px;">
<p>Thank you for your purchase from <strong>FXAPWORLD</strong>.</p>
<p>Order reference: <code>${escapeHtmlText(sessionId)}</code></p>
<p>Your download links:</p>
<ul>${listHtml}</ul>
<p style="color:#888;font-size:14px;">If you signed in with Discord before checkout, you also have the customer role in our server.</p>
</body></html>`;

    await transport.sendMail({
        from: fromAddr,
        to,
        subject: 'Your FXAPWORLD purchase — download links',
        html
    });
    console.log('purchase email sent OK for session', sessionId);
}

async function assignCustomerRole(userId) {
    if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_CUSTOMER_ROLE_ID || !userId) return;

    const url = `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${userId}/roles/${DISCORD_CUSTOMER_ROLE_ID}`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` }
    });

    if (res.ok || res.status === 204) {
        console.log('assignCustomerRole ok', userId);
        return;
    }
    const { text, json } = await discordResponseInfo(res);
    console.error('assignCustomerRole failed', res.status, json || text.slice(0, 500));
}

async function processOrder(session, userId, items) {
    if (!items || !items.length) return;
    console.log(`Processing order session=${session.id} userId=${userId || '(none)'}`, items);

    let enriched;
    try {
        enriched = await enrichItemsWithDownloads(items);
    } catch (e) {
        console.error('processOrder enrich', e);
        enriched = items.map(normalizeMetaItem);
    }

    const email =
        (session.customer_details && session.customer_details.email) ||
        session.customer_email ||
        '';

    if (email) {
        try {
            await sendPurchaseEmail(email, enriched, session.id);
        } catch (error) {
            console.error('sendPurchaseEmail', error);
        }
    } else {
        console.warn(
            'No buyer email on Stripe session — enable customer email in Checkout or use session retrieve',
            session.id
        );
    }

    if (!userId || !DISCORD_BOT_TOKEN) return;

    try {
        await assignCustomerRole(userId);
    } catch (error) {
        console.error('assignCustomerRole', error);
    }

    try {
        await sendDiscordDM(userId, enriched);
    } catch (error) {
        console.error('sendDiscordDM', error);
    }
}

async function sendDiscordDM(userId, items) {
    const dmChannelResponse = await fetch('https://discord.com/api/users/@me/channels', {
        method: 'POST',
        headers: {
            Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ recipient_id: userId })
    });

    const { text: dmText, json: dmJson } = await discordResponseInfo(dmChannelResponse);
    const dmChannel = dmJson || {};
    if (!dmChannelResponse.ok || !dmChannel.id) {
        console.error('Discord DM channel failed', dmChannelResponse.status, dmJson || dmText.slice(0, 400));
        return;
    }

    const lines = items.map((item) => {
        const price = item.price != null ? ` — $${Number(item.price).toFixed(2)}` : '';
        const link = item.downloadUrl && /^https?:\/\//i.test(item.downloadUrl)
            ? `\n  ${item.downloadUrl}`
            : '\n  (download link in your email)';
        return `• ${item.name}${price}${link}`;
    });

    const embedItems = items.slice(0, 25);
    const extra = items.length > 25 ? `\n\n_+${items.length - 25} more — see your email._` : '';

    const message = {
        content:
            `Thank you for your purchase from **FXAPWORLD**!\n\n` +
            `${lines.join('\n\n')}${extra}\n\n` +
            `_You were given the customer role in our Discord._`,
        embeds: [
            {
                title: 'Purchase successful',
                description: 'Your FiveM resources',
                color: 0xff2d95,
                fields: embedItems.map((item) => ({
                    name: String(item.name || item.id).slice(0, 256),
                    value: (item.downloadUrl ? item.downloadUrl : 'See email for links').slice(0, 1024),
                    inline: false
                })),
                footer: { text: 'FXAPWORLD — FiveM resources' }
            }
        ]
    };

    await fetch(`https://discord.com/api/channels/${dmChannel.id}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`FXAPWORLD API listening on port ${PORT}`);
});
