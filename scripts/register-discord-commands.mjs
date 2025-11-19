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
  }
];

async function registerCommands() {
  try {
    const url = DISCORD_GUILD_ID
      ? `${DISCORD_API}/applications/${DISCORD_CLIENT_ID}/guilds/${DISCORD_GUILD_ID}/commands`
      : `${DISCORD_API}/applications/${DISCORD_CLIENT_ID}/commands`;
    
    const scope = DISCORD_GUILD_ID ? 'guild' : 'global';
    console.log(`\n📝 Registering ${scope} commands...`);
    
    for (const command of commands) {
      console.log(`   Registering: /${command.name}`);
      
      const response = await axios.put(
        `${url}/${command.name}`,
        command,
        {
          headers: {
            'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`   ✅ Registered: /${command.name} (ID: ${response.data.id})`);
    }
    
    console.log(`\n✅ All commands registered successfully!`);
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

