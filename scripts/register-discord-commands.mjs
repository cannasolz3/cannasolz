#!/usr/bin/env node
/**
 * Script to register Discord slash commands
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const rootDir = join(__dirname, '..');
dotenv.config({ path: join(rootDir, 'config/.env') });

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('ERROR: DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set');
  process.exit(1);
}

// Discord API endpoints
const DISCORD_API = 'https://discord.com/api/v10';

// Commands to register
const commands = [
  {
    name: 'collection',
    description: 'Display CannaSolz collection statistics from Magic Eden',
    type: 1 // CHAT_INPUT
  },
  {
    name: 'mynfts',
    description: 'View your CannaSolz NFT holdings',
    type: 1 // CHAT_INPUT
  }
];

async function registerCommands() {
  try {
    // Check if we should register globally or to a specific guild
    // Set REGISTER_GLOBAL=true to register globally, or provide DISCORD_GUILD_ID for a specific server
    const registerGlobal = process.env.REGISTER_GLOBAL === 'true' || !DISCORD_GUILD_ID;
    
    const url = registerGlobal
      ? `${DISCORD_API}/applications/${DISCORD_CLIENT_ID}/commands`
      : `${DISCORD_API}/applications/${DISCORD_CLIENT_ID}/guilds/${DISCORD_GUILD_ID}/commands`;
    
    const scope = registerGlobal ? 'global' : 'guild';
    console.log(`\n📝 Registering ${scope} commands...`);
    if (!registerGlobal) {
      console.log(`   Guild ID: ${DISCORD_GUILD_ID}`);
    }
    
    // First, delete all existing commands (optional - comment out if you want to keep existing commands)
    // Uncomment the following block if you want to clear all commands first:
    /*
    console.log('   Clearing existing commands...');
    await axios.put(url, [], {
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    */
    
    // Register all commands at once using PUT (bulk update)
    console.log(`   Registering ${commands.length} command(s)...`);
    for (const command of commands) {
      console.log(`      - /${command.name}: ${command.description}`);
    }
    
    const response = await axios.put(
      url,
      commands,
      {
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`\n✅ Successfully registered ${response.data.length} command(s)!`);
    response.data.forEach(cmd => {
      console.log(`   ✅ /${cmd.name} (ID: ${cmd.id})`);
    });
    
    console.log(`\nCommands are now available in ${scope === 'guild' ? 'your server' : 'all servers'}`);
    
  } catch (error) {
    console.error('❌ Error registering commands:', error.response?.data || error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

registerCommands()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

