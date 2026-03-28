// Optional backend template for RTX (payments, Discord, file delivery)
// This is a Node.js/Express backend to handle payments and Discord integration
// Install dependencies: npm install express stripe cors dotenv node-fetch

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL // Your GitHub Pages URL
}));
app.use(express.json());

// Discord configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

// Create payment intent
app.post('/api/create-payment-intent', async (req, res) => {
    try {
        const { amount, items, userId } = req.body;
        
        // Create a payment intent
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: 'usd',
            metadata: {
                userId: userId,
                items: JSON.stringify(items)
            }
        });
        
        res.json({
            clientSecret: paymentIntent.client_secret
        });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ error: 'Failed to create payment intent' });
    }
});

// Handle successful payment webhook
app.post('/api/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Handle the event
    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        
        // Extract order details
        const userId = paymentIntent.metadata.userId;
        const items = JSON.parse(paymentIntent.metadata.items);
        
        // Process order - send files to customer
        await processOrder(userId, items);
        
        console.log(`Payment succeeded for user ${userId}`);
    }
    
    res.json({received: true});
});

// Join Discord server
app.post('/api/discord/join', async (req, res) => {
    try {
        const { userId, accessToken } = req.body;
        
        // Add user to Discord server using bot
        const response = await fetch(
            `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${userId}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    access_token: accessToken
                })
            }
        );
        
        if (response.ok) {
            res.json({ success: true, message: 'Successfully joined Discord server' });
        } else {
            const error = await response.json();
            console.error('Discord API error:', error);
            res.status(400).json({ success: false, error: 'Failed to join server' });
        }
    } catch (error) {
        console.error('Error joining Discord server:', error);
        res.status(500).json({ error: 'Failed to join Discord server' });
    }
});

// Process order and deliver files
async function processOrder(userId, items) {
    // TODO: Implement file delivery system
    // This could involve:
    // 1. Sending DM to user on Discord with download links
    // 2. Storing order in database
    // 3. Generating temporary download links
    // 4. Sending email with files
    
    console.log(`Processing order for user ${userId}:`, items);
    
    try {
        // Example: Send DM via Discord webhook or bot
        await sendDiscordDM(userId, items);
    } catch (error) {
        console.error('Error processing order:', error);
    }
}

// Send Discord DM with purchase details
async function sendDiscordDM(userId, items) {
    // Create DM channel
    const dmChannelResponse = await fetch(
        'https://discord.com/api/users/@me/channels',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                recipient_id: userId
            })
        }
    );
    
    const dmChannel = await dmChannelResponse.json();
    
    if (!dmChannel.id) {
        console.error('Failed to create DM channel');
        return;
    }
    
    // Send message with purchase details
    const message = {
        content: `Thank you for your purchase from RTX!\n\nYou have purchased:\n${items.map(item => `- ${item.name} ($${item.price})`).join('\n')}\n\nYour download links will be provided shortly.`,
        embeds: [{
            title: '🎉 Purchase Successful',
            description: 'Your FiveM resources are ready!',
            color: 0xff2d95,
            fields: items.map(item => ({
                name: item.name,
                value: `$${item.price}`,
                inline: true
            })),
            footer: {
                text: 'RTX — FiveM resources'
            }
        }]
    };
    
    await fetch(
        `https://discord.com/api/channels/${dmChannel.id}/messages`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(message)
        }
    );
}

// Start server
app.listen(PORT, () => {
    console.log(`RTX backend running on port ${PORT}`);
});

/* 
SETUP INSTRUCTIONS:

1. Create .env file with:
   STRIPE_SECRET_KEY=your_stripe_secret_key
   STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
   DISCORD_BOT_TOKEN=your_discord_bot_token
   DISCORD_GUILD_ID=your_discord_server_id
   FRONTEND_URL=https://yourusername.github.io/yourrepo
   PORT=3000

2. Install dependencies:
   npm install express stripe cors dotenv node-fetch

3. Run server:
   node server.js

4. Deploy to Heroku/DigitalOcean/AWS

5. Update frontend config.js to point to your backend URL
*/
