require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// Uses Render's external URL, or falls back to your custom domain
const BASE_URL = process.env.RENDER_EXTERNAL_URL || 'https://yokoe.xyz';

// Reliable Discord Webhook Notification Helper
async function sendDiscordWebhook(title, description, botData, color = 0x5865F2, customWebhookUrl = null) {
  // Use custom URL if provided, otherwise fall back to main webhook URL
  const webhookUrl = customWebhookUrl || process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  // 1. Strict URL check for avatar (Ignores base64 'data:image...' strings)
  let avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';
  if (
    botData.avatar && 
    typeof botData.avatar === 'string' && 
    botData.avatar.toLowerCase().startsWith('http')
  ) {
    avatarUrl = botData.avatar;
  }

  // 2. Build payload safely
  const payload = {
    username: 'Yokoe Directory',
    embeds: [
      {
        title: String(title || 'New Bot Listing'),
        description: String(description || 'A bot was submitted.'),
        color: color,
        thumbnail: { url: avatarUrl },
        fields: [
          { name: '🤖 Bot Name', value: String(botData.name || 'Unknown Bot'), inline: true },
          { name: '🏷️ Category', value: String(botData.category || 'Utility'), inline: true },
          { name: '👤 Owner ID', value: botData.ownerId ? String(botData.ownerId) : 'Anonymous', inline: true }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Yokoe Bot Directory' }
      }
    ]
  };

  // 3. Strict URL check for invite link
  if (
    botData.invite && 
    typeof botData.invite === 'string' && 
    botData.invite.toLowerCase().startsWith('http')
  ) {
    payload.embeds[0].fields.push({
      name: '🔗 Invite Link',
      value: `[Click to Invite](${botData.invite})`,
      inline: false
    });
  }

  try {
    await axios.post(webhookUrl, payload);
    console.log('✅ Discord Webhook delivered successfully!');
  } catch (err) {
    console.error('❌ DISCORD REJECTED PAYLOAD:', err.response ? err.response.data : err.message);
  }
}

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- CLEAN PAGE ROUTING (Place BEFORE express.static) ---

// 1. Root '/' serves landing.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// 2. '/explore', '/bots', and '/bot/:id' serve explore.html
app.get(['/explore', '/bots', '/bot/:id'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'explore.html'));
});

// Serve static assets (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// Database Schema (Includes Webhooks & Analytics)
const BotSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, default: 'Utility' },
  servers: { type: String, default: '1.0k+' },
  ping: { type: String, default: '20ms' },
  votes: { type: Number, default: 0 },
  views: { type: Number, default: 0 },         // 📈 Page Views
  inviteClicks: { type: Number, default: 0 },  // 📈 Invite Clicks
  votedUsers: [{
    discordId: String,
    votedAt: { type: Date, default: Date.now }
  }],
  // Developer Webhook Settings
  webhookUrl: { type: String, default: '' },
  webhookSecret: { type: String, default: '' },

  featured: { type: Boolean, default: false },
  verified: { type: Boolean, default: false },
  avatar: { type: String, required: true },
  banner: { type: String, default: '' },
  invite: { type: String, required: true },
  status: { type: String, default: 'Online' },
  description: { type: String, required: true },
  commands: { type: String, default: '' },
  usage: { type: String, default: '' },
  config: { type: String, default: '' },
  reviews: [{
    author: String,
    discordId: String,
    avatar: String,
    rating: Number,
    text: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

const Bot = mongoose.model('Bot', BotSchema);

// API Routes: Fetch All Bots
app.get('/api/bots', async (req, res) => {
  try {
    const bots = await Bot.find().sort({ createdAt: -1 });
    res.json(bots);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bots' });
  }
});

// Upvote Endpoint with 12-Hour Cooldown & Discord Webhook Notification
app.post('/api/bots/:id/upvote', async (req, res) => {
  try {
    const { discordId, username } = req.body;
    if (!discordId) return res.status(401).json({ error: 'You must log in with Discord to upvote.' });

    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found.' });

    const existingVote = bot.votedUsers.find(v => v.discordId === discordId);
    if (existingVote) {
      const hoursSinceVote = (new Date() - new Date(existingVote.votedAt)) / (1000 * 60 * 60);
      if (hoursSinceVote < 12) {
        const remaining = Math.ceil(12 - hoursSinceVote);
        return res.status(429).json({ error: `You can vote for this bot again in ${remaining} hours.` });
      }
      existingVote.votedAt = new Date();
    } else {
      bot.votedUsers.push({ discordId, votedAt: new Date() });
    }

    bot.votes += 1;
    await bot.save();

    // 📣 1. Send Upvote Notification to #upvotes Channel
    const upvoteWebhook = process.env.DISCORD_UPVOTE_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
    await sendDiscordWebhook(
      '❤️ New Upvote Received!',
      `**${username || 'A user'}** upvoted **${bot.name}**!\nTotal Votes: **${bot.votes}**`,
      bot,
      0xED4245, // Red color
      upvoteWebhook
    );

    // 🚀 2. TRIGGER DEVELOPER VOTE WEBHOOK (Only if configured)
    if (bot.webhookUrl && bot.webhookUrl.toLowerCase().startsWith('http')) {
      const votePayload = {
        botId: bot._id,
        userId: discordId,
        username: username || 'Unknown',
        type: 'upvote',
        votedAt: new Date().toISOString(),
        totalVotes: bot.votes
      };

      axios.post(bot.webhookUrl, votePayload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': bot.webhookSecret || ''
        },
        timeout: 5000
      }).catch(err => {
        console.error(`⚠️ Failed to send developer vote webhook for ${bot.name}:`, err.message);
      });
    }

    res.json(bot);
  } catch (err) {
    res.status(400).json({ error: 'Upvote failed.' });
  }
});

// 📈 Increment Page View Counter Endpoint
app.post('/api/bots/:id/view', async (req, res) => {
  try {
    const bot = await Bot.findByIdAndUpdate(
      req.params.id, 
      { $inc: { views: 1 } }, 
      { new: true }
    );
    res.json({ views: bot ? bot.views : 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record view' });
  }
});

// 📈 Track Invite Button Clicks Endpoint
app.post('/api/bots/:id/invite-click', async (req, res) => {
  try {
    const bot = await Bot.findByIdAndUpdate(
      req.params.id, 
      { $inc: { inviteClicks: 1 } }, 
      { new: true }
    );
    res.json({ inviteClicks: bot ? bot.inviteClicks : 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record click' });
  }
});

// ⚡ Auto-Sync Bot Info via Discord Public User API
app.get('/api/bots/sync-discord/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const response = await axios.get(`https://discord.com/api/v10/users/${clientId}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN || ''}` }
    });

    const botData = response.data;
    const avatarUrl = botData.avatar 
      ? `https://cdn.discordapp.com/avatars/${botData.id}/${botData.avatar}.png?size=512`
      : 'https://cdn.discordapp.com/embed/avatars/0.png';

    res.json({
      name: botData.username,
      avatar: avatarUrl,
      id: botData.id
    });
  } catch (err) {
    res.status(400).json({ error: 'Could not fetch Discord bot info. Check your Client ID.' });
  }
});

// Review Endpoint requiring Login
app.post('/api/bots/:id/reviews', async (req, res) => {
  try {
    const { author, discordId, avatar, rating, text } = req.body;
    if (!discordId) return res.status(401).json({ error: 'You must log in with Discord to leave a review.' });

    const bot = await Bot.findById(req.params.id);
    if (!bot) return res.status(404).json({ error: 'Bot not found.' });

    bot.reviews.unshift({ author, discordId, avatar, rating, text });
    await bot.save();
    res.json(bot);
  } catch (err) {
    res.status(400).json({ error: 'Failed to submit review.' });
  }
});

// Admin Manage Endpoint (Add / Edit Bot + Discord Alerts)
app.post('/api/bots/manage', async (req, res) => {
  try {
    const { id, ...botData } = req.body;
    let savedBot;

    if (id && mongoose.Types.ObjectId.isValid(id)) {
      // --- UPDATING AN EXISTING BOT ---
      savedBot = await Bot.findByIdAndUpdate(id, botData, { new: true, runValidators: true });

      if (savedBot.status === 'Maintenance') {
        // 🟠 Maintenance Alert
        await sendDiscordWebhook(
          '🛠️ Bot Under Maintenance',
          `**${savedBot.name}** has entered maintenance mode.`,
          savedBot,
          0xE67E22
        );
      } else {
        // 🟡 General Update Alert
        await sendDiscordWebhook(
          '✏️ Bot Updated',
          `**${savedBot.name}** details or status were updated on the directory.`,
          savedBot,
          0xFEE75C
        );
      }

    } else {
      // --- ADDING A NEW BOT ---
      savedBot = new Bot(botData);
      await savedBot.save();

      // 🟢 New Bot Alert
      await sendDiscordWebhook(
        '🎉 New Bot Added!',
        `**${savedBot.name}** was just listed on the Yokoe Directory.`,
        savedBot,
        0x57F287
      );
    }

    res.json(savedBot);
  } catch (err) {
    console.error('SERVER ERROR WHEN SAVING BOT:', err);
    res.status(400).json({ error: err.message || 'Save failed' });
  }
});

// Delete Bot + Discord Alert
app.delete('/api/bots/:id', async (req, res) => {
  try {
    const deletedBot = await Bot.findByIdAndDelete(req.params.id);

    if (!deletedBot) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    // 🔴 Delete Alert
    await sendDiscordWebhook(
      '🗑️ Bot Removed',
      `**${deletedBot.name}** was removed from the Yokoe Directory.`,
      deletedBot,
      0xED4245
    );

    res.json({ message: 'Bot deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Discord OAuth2 Login Redirect
app.get('/api/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID || '1530643369351581878';
  const redirectUri = encodeURIComponent(`${BASE_URL}/api/auth/callback`);
  const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
  res.redirect(url);
});

// Discord OAuth2 Callback Handler
app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Authorization code missing.');

  try {
    const redirectUri = `${BASE_URL}/api/auth/callback`;

    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID || '1530643369351581878',
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const accessToken = tokenResponse.data.access_token;
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const user = userResponse.data;
    const adminIds = (process.env.ADMIN_DISCORD_IDS || '').split(',');
    const isAdmin = adminIds.includes(user.id);
    const avatarUrl = user.avatar 
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
      : 'https://cdn.discordapp.com/embed/avatars/0.png';

    res.send(`
      <script>
        window.opener.postMessage({
          type: 'DISCORD_AUTH_SUCCESS',
          user: {
            id: '${user.id}',
            username: '${user.username}',
            avatar: '${avatarUrl}',
            isAdmin: ${isAdmin}
          }
        }, '*');
        window.close();
      </script>
    `);
  } catch (err) {
    console.error('OAuth Error Details:', err.response ? err.response.data : err.message);
    res.status(500).send('Discord authentication failed.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
