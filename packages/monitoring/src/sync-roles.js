import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { syncUserRoles } from './discord/roles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate required environment variables
const requiredEnvVars = ['POSTGRES_URL', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

// Initialize database connection
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false,
    sslmode: 'require'
  }
});

async function updateAllRoles() {
  const client = await pool.connect();
  try {
    // Read and execute the SQL script
    const sqlScript = fs.readFileSync(
      path.join(__dirname, 'db', 'update_all_roles.sql'),
      'utf8'
    );
    
    console.log('Executing role update SQL...');
    await client.query(sqlScript);
    console.log('SQL execution completed');

    // Get all users with Discord IDs
    const result = await client.query(
      'SELECT discord_id FROM user_roles WHERE discord_id IS NOT NULL'
    );

    console.log(`Found ${result.rows.length} users to sync with Discord`);

    // Sync each user's roles with Discord
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      try {
        console.log(`Syncing roles for Discord user ${row.discord_id} (${i + 1} of ${result.rows.length})...`);
        const success = await syncUserRoles(row.discord_id, process.env.DISCORD_GUILD_ID);
        if (success) {
          console.log(`Successfully synced roles for ${row.discord_id}`);
        } else {
          console.error(`Failed to sync roles for ${row.discord_id}`);
        }
      } catch (error) {
        console.error(`Error syncing roles for ${row.discord_id}:`, error);
      }
    }

    console.log('Role sync completed');
    console.log('All Discord role syncs completed!');
  } catch (error) {
    console.error('Error updating roles:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the update
updateAllRoles().catch(console.error); 