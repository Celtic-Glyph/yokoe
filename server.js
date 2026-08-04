require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// Function to send rich Discord Webhook embeds
async function sendDiscordWebhook(title, description, botData, color = 0x5865F2) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await axios.post(webhookUrl, {
      embeds: [
        {
          title: title,
          description: description,
          color: color, // 0x5865F2 is Discord Blue
          thumbnail: {
            url: botData.avatar || 'https://i.imgur.com/8N3Oa6E.png'
          },
          fields: [
            { name: '🤖 Bot Name', value: botData.name || 'N/A', inline: true },
            { name: '🏷️ Category', value: botData.category || 'Utility', inline: true },
            { name: '👤 Owner ID', value: botData.ownerId ? `<@${botData.ownerId}>` : 'Anonymous', inline: true },
            { name: '🔗 Invite Link', value: botData.inviteUrl ? `[Click to Invite](${botData.inviteUrl})` : 'None', inline: false }
          ],
          timestamp: new Date().toISOString(),
          footer: {
            text: 'Yokoe Bot Directory',
            icon_url: 'https://i.imgur.com/8N3Oa6E.png'
          }
        }
      ]
    });
  } catch (err) {
    console.error('Webhook notification error:', err.message);
  }
}

const app = express();

// Route for the main homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});


app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// Database Schema
const BotSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, default: 'Utility' },
  servers: { type: String, default: '1.0k+' },
  ping: { type: String, default: '20ms' },
  votes: { type: Number, default: 0 },
  votedUsers: [{
    discordId: String,
    votedAt: { type: Date, default: Date.now }
  }],
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

// Upvote Endpoint with 12-Hour Cooldown per User
app.post('/api/bots/:id/upvote', async (req, res) => {
  try {
    const { discordId } = req.body;
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
    res.json(bot);
  } catch (err) {
    res.status(400).json({ error: 'Upvote failed.' });
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

// Admin Manage Endpoint (Add / Edit Bot)
app.post('/api/bots/manage', async (req, res) => {
  try {
    const { id, ...botData } = req.body;
    let savedBot;

    if (id && mongoose.Types.ObjectId.isValid(id)) {
      savedBot = await Bot.findByIdAndUpdate(id, botData, { new: true, runValidators: true });
    } else {
      savedBot = new Bot(botData);
      await savedBot.save();

      // 🚀 Send Discord Webhook alert for NEW bots!
      sendDiscordWebhook(
        '🎉 New Bot Added!',
        `**${savedBot.name}** was just listed on the Yokoe Directory.`,
        savedBot,
        0x57F287 // Green color
      );
    }

    res.json(savedBot);
  } catch (err) {
    console.error('SERVER ERROR WHEN SAVING BOT:', err);
    res.status(400).json({ error: err.message || 'Save failed' });
  }
});

// Delete Bot
app.delete('/api/bots/:id', async (req, res) => {
  try {
    await Bot.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Delete failed' });
  }
});

// Discord OAuth2 Login Redirect
app.get('/api/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID || '1530643369351581878';
  const redirectUri = encodeURIComponent('http://localhost:3000/api/auth/callback');
  const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
  res.redirect(url);
});

// Discord OAuth2 Callback Handler
app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Authorization code missing.');

  try {
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID || '1530643369351581878',
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: 'http://localhost:3000/api/auth/callback',
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
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
