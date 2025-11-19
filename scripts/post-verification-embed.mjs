import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables - same pattern as other scripts
const rootDir = join(__dirname, '..');
dotenv.config({ path: join(rootDir, 'config/.env') });

// Function to get bot token with correct prefix
function getBotToken() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error('\n❌ DISCORD_BOT_TOKEN environment variable not set!');
    console.error('\nTo run this script, you need to:');
    console.error('1. Set DISCORD_BOT_TOKEN in your .env file, or');
    console.error('2. Export it as an environment variable:');
    console.error('   export DISCORD_BOT_TOKEN="your_token_here"');
    console.error('\nYou can get the token from Vercel environment variables or your Discord bot application.\n');
    throw new Error('DISCORD_BOT_TOKEN environment variable not set');
  }
  return token.startsWith('Bot ') ? token : `Bot ${token}`;
}

// Channel ID for holder verification
const CHANNEL_ID = '1246214724920545332';

// Favicon URL (using Vercel deployment)
const FAVICON_URL = 'https://cannasolz.vercel.app/favicon.jpeg';

async function postVerificationEmbed() {
  try {
    const token = getBotToken();

    const embed = {
      title: 'CannaSolz Holder Verification',
      description: 'Verify your NFT or token holdings! Follow the simple steps below to verify.',
      color: 0x95D5B2, // Green color matching the brand
      thumbnail: {
        url: FAVICON_URL
      },
      fields: [
        {
          name: 'Step 1:',
          value: 'Visit https://cannasolz.vercel.app/ on a PC or mobile device wallet-browser.',
          inline: false
        },
        {
          name: 'Step 2:',
          value: 'Log in with Discord. CannaBot will ask permission to access your username. Authorize to continue.',
          inline: false
        },
        {
          name: 'Step 3:',
          value: 'Log in with a Solana Wallet and click Connect. Note: CannaBot only uses your public address and will never request transactions. Once logged in, click Add Wallet. Multiple wallets may be added.',
          inline: false
        },
        {
          name: '\u200b', // Zero-width space for spacing
          value: 'Once verified your holder roles will be assigned in this server and you will start earning $CSz420 token rewards. You can return to the site any time to claim your rewards.',
          inline: false
        }
      ]
    };

    // Send embed using Discord API
    const response = await axios.post(
      `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`,
      {
        embeds: [embed],
        tts: false,
        allowed_mentions: { parse: [] }
      },
      {
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Verification embed posted successfully!');
    console.log('Message ID:', response.data.id);
    return true;
  } catch (error) {
    console.error('❌ Error posting verification embed:', error.response?.data || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 403) {
        console.error('\n⚠️  The bot needs the following permissions in the channel:');
        console.error('   - Send Messages');
        console.error('   - Embed Links');
        console.error('\nMake sure the bot is added to the server and has access to channel:', CHANNEL_ID);
      }
    }
    return false;
  }
}

// Run the script
postVerificationEmbed()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

