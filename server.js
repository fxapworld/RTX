/**
 * RTX payment API — deploy separately from GitHub Pages (Render, Railway, Fly.io, VPS).
 *
 * Stripe Dashboard → Webhooks → Endpoint URL must be YOUR API:
 *   https://YOUR-HOST/api/webhook
 * (NOT a Discord URL — Discord is notified via DISCORD_PURCHASE_WEBHOOK_URL below.)
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FRONTEND_URL,
 *       DISCORD_PURCHASE_WEBHOOK_URL (optional staff notifications)
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

const app = express();

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (!FRONTEND_ORIGIN) return cb(null, true);
        if (origin === FRONTEND_ORIGIN) return cb(null, true);
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
        const session = event.data.object;
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
        await processOrder(userId, items);
    }

    res.json({ received: true });
});

app.use(express.json());

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
                    name: item.name || 'RTX item',
                    metadata: { product_id: String(item.id || '') }
                },
                unit_amount: Math.round(Number(item.price) * 100)
            },
            quantity: 1
        }));

        const compactItems = items.map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price
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
                        description: 'RTX marketplace order',
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

app.post('/api/discord/join', async (req, res) => {
    try {
        const { userId, accessToken } = req.body;
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
        const error = await response.json();
        console.error('Discord API error', error);
        res.status(400).json({ success: false, error: 'Failed to join server' });
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
        title: 'New RTX purchase',
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
                username: 'RTX purchases'
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

async function processOrder(userId, items) {
    if (!items || !items.length) return;
    console.log(`Processing order for user ${userId}:`, items);

    if (!DISCORD_BOT_TOKEN || !userId) return;

    try {
        await sendDiscordDM(userId, items);
    } catch (error) {
        console.error('processOrder', error);
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

    const dmChannel = await dmChannelResponse.json();
    if (!dmChannel.id) {
        console.error('Failed to create DM channel', dmChannel);
        return;
    }

    const message = {
        content: `Thank you for your purchase from RTX!\n\nYou purchased:\n${items.map((item) => `- ${item.name} ($${item.price})`).join('\n')}\n\nYour download links will follow.`,
        embeds: [
            {
                title: 'Purchase successful',
                description: 'Your FiveM resources',
                color: 0xff2d95,
                fields: items.map((item) => ({
                    name: item.name,
                    value: `$${item.price}`,
                    inline: true
                })),
                footer: { text: 'RTX — FiveM resources' }
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
    console.log(`RTX API listening on port ${PORT}`);
});
