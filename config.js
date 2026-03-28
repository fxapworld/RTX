// Configuration for RTX — FiveM marketplace (GitHub Pages + optional backend)

const CONFIG = {
    // Deploy server.js (Render, Railway, Fly.io, VPS) and paste its public URL here — required for real payments.
    // Stripe Dashboard → Webhooks → Endpoint = https://YOUR-API-HOST/api/webhook (not Discord).
    // Discord purchase alerts: set DISCORD_PURCHASE_WEBHOOK_URL only in server .env (not in config.js).
    apiBaseUrl: 'YOUR_API_URL',

    discord: {
        clientId: 'YOUR_DISCORD_CLIENT_ID',
        redirectUri: 'https://fxapworld.github.io/RTX/',
        scope: 'identify guilds.join',
        guildId: 'YOUR_DISCORD_SERVER_ID',
        botToken: 'YOUR_DISCORD_BOT_TOKEN'
    },

    // Publishable key is safe in the browser (optional — only if you add Stripe.js features later).
    stripe: {
        publishableKey: 'YOUR_STRIPE_PUBLISHABLE_KEY'
    },

    // PayPal — leave disabled if you only use Stripe.
    paypal: {
        enabled: false,
        clientId: '',
        sandbox: false
    },

    store: {
        name: 'RTX',
        currency: 'USD',
        tagline: 'Premium FiveM resources'
    },

    // Simple gate for admin.html (not secret in repo — use private repo or omit admin link)
    admin: {
        accessKey: 'change-me'
    }
};

// Note: For production, you'll need a backend server to handle:
// 1. Stripe payment processing (never expose secret keys in frontend)
// 2. Discord bot operations (auto-join server)
// 3. Order processing and delivery
//
// This is a frontend-only implementation. For full functionality:
// - Set up a backend server (Node.js, Python, etc.)
// - Store sensitive keys server-side
// - Handle payment webhooks from Stripe
// - Automate Discord server joins via bot
