#!/usr/bin/env node
/**
 * Script to manually rebuild roles for a specific user
 * Usage: node scripts/rebuild-user-roles.mjs <discord_id>
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const rootDir = join(__dirname, '..');
dotenv.config({ path: join(rootDir, 'config/.env') });

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('ERROR: POSTGRES_URL environment variable is not set');
  process.exit(1);
}

const discordId = process.argv[2];

if (!discordId) {
  console.error('Usage: node scripts/rebuild-user-roles.mjs <discord_id>');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function rebuildUserRoles() {
  const client = await pool.connect();
  try {
    console.log(`\n🔄 Rebuilding roles for Discord ID: ${discordId}`);
    
    // Ensure harvester columns exist
    const harvesterColumns = [
      'harvester_gold',
      'harvester_silver',
      'harvester_purple',
      'harvester_dark_green',
      'harvester_light_green'
    ];
    
    for (const col of harvesterColumns) {
      try {
        await client.query(`ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS ${col} BOOLEAN DEFAULT FALSE`);
      } catch (error) {
        if (error.code !== '42701') console.error(`Error adding ${col}:`, error.message);
      }
    }

    // Update harvester flags from collection_counts
    await client.query(
      `
        INSERT INTO user_roles (discord_id, harvester_gold, harvester_silver, harvester_purple, harvester_dark_green, harvester_light_green)
        SELECT 
          $1::varchar,
          (cnft_gold_count > 0) AS harvester_gold,
          (cnft_silver_count > 0) AS harvester_silver,
          (cnft_purple_count > 0) AS harvester_purple,
          (cnft_dark_green_count > 0) AS harvester_dark_green,
          (cnft_light_green_count > 0) AS harvester_light_green
        FROM collection_counts
        WHERE discord_id = $1::varchar
        ON CONFLICT (discord_id) DO UPDATE SET
          harvester_gold = EXCLUDED.harvester_gold,
          harvester_silver = EXCLUDED.harvester_silver,
          harvester_purple = EXCLUDED.harvester_purple,
          harvester_dark_green = EXCLUDED.harvester_dark_green,
          harvester_light_green = EXCLUDED.harvester_light_green
      `,
      [discordId]
    );

    // Rebuild roles JSONB
    await client.query('SELECT rebuild_user_roles($1::varchar)', [discordId]);
    
    console.log('✅ Roles rebuilt successfully!');
    
    // Show current roles
    const rolesResult = await client.query(
      'SELECT roles FROM user_roles WHERE discord_id = $1',
      [discordId]
    );
    
    if (rolesResult.rows.length > 0) {
      console.log('\n📋 Current roles JSONB:');
      console.log(JSON.stringify(rolesResult.rows[0].roles, null, 2));
    }
    
    // Sync Discord roles if guild ID is set
    const guildId = process.env.DISCORD_GUILD_ID;
    if (guildId) {
      console.log('\n🔄 Syncing Discord roles...');
      try {
        const { syncUserRoles } = await import('../packages/backend/src/api/integrations/discord/roles.js');
        const success = await syncUserRoles(discordId, guildId);
        if (success) {
          console.log('✅ Discord roles synced successfully!');
        } else {
          console.log('⚠️  Discord role sync completed with warnings (check logs)');
        }
      } catch (error) {
        console.error('⚠️  Error syncing Discord roles (non-fatal):', error.message);
      }
    } else {
      console.log('⚠️  DISCORD_GUILD_ID not set, skipping Discord role sync');
    }
    
  } catch (error) {
    console.error('❌ Error rebuilding roles:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

rebuildUserRoles()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

