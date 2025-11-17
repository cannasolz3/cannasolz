#!/usr/bin/env node
/**
 * Script to insert HARVESTER roles into the roles table
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootDir = join(__dirname, '..');
dotenv.config({ path: join(rootDir, 'config/.env') });

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('ERROR: POSTGRES_URL environment variable is not set');
  process.exit(1);
}

const HARVESTER_ROLES = [
  {
    name: 'HARVESTER Gold',
    display_name: 'HARVESTER Gold',
    discord_role_id: '1260017043005112330',
    type: 'holder', // Using 'holder' type since it's based on NFT ownership
    collection: 'seedling_gold',
    color: '#d5ba46',
    emoji_url: null
  },
  {
    name: 'HARVESTER Silver',
    display_name: 'HARVESTER Silver',
    discord_role_id: '1260016966324846592',
    type: 'holder',
    collection: 'seedling_silver',
    color: '#9aaaaa',
    emoji_url: null
  },
  {
    name: 'HARVESTER Purple',
    display_name: 'HARVESTER Purple',
    discord_role_id: '1260016886587068556',
    type: 'holder',
    collection: 'seedling_purple',
    color: '#9b59b6',
    emoji_url: null
  },
  {
    name: 'HARVESTER Dark Green',
    display_name: 'HARVESTER Dark Green',
    discord_role_id: '1260016258087387297',
    type: 'holder',
    collection: 'seedling_dark_green',
    color: '#004a1f',
    emoji_url: null
  },
  {
    name: 'HARVESTER Light Green',
    display_name: 'HARVESTER Light Green',
    discord_role_id: '1248728576770048140',
    type: 'holder',
    collection: 'seedling_light_green',
    color: '#6bfb7d',
    emoji_url: null
  }
];

async function main() {
  const pool = new Pool({
    connectionString: POSTGRES_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  
  const client = await pool.connect();
  
  try {
    console.log('\n🎭 Inserting HARVESTER roles into roles table...\n');
    
    for (const role of HARVESTER_ROLES) {
      try {
        await client.query(
          `INSERT INTO roles (
            name,
            display_name,
            discord_role_id,
            type,
            collection,
            color,
            emoji_url
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (discord_role_id) DO UPDATE SET
            name = EXCLUDED.name,
            display_name = EXCLUDED.display_name,
            type = EXCLUDED.type,
            collection = EXCLUDED.collection,
            color = EXCLUDED.color,
            emoji_url = EXCLUDED.emoji_url`,
          [
            role.name,
            role.display_name,
            role.discord_role_id,
            role.type,
            role.collection,
            role.color,
            role.emoji_url
          ]
        );
        console.log(`✅ Inserted/Updated: ${role.display_name}`);
      } catch (error) {
        console.error(`❌ Error inserting ${role.display_name}:`, error.message);
      }
    }
    
    console.log('\n✅ All HARVESTER roles inserted/updated!\n');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();

