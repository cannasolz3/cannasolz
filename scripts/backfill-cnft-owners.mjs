#!/usr/bin/env node
/**
 * Backfill script to update owner_discord_id and owner_name for existing cNFTs
 * based on linked wallets in user_wallets table
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

async function backfillCnftOwners() {
  const pool = new Pool({
    connectionString: POSTGRES_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  
  const client = await pool.connect();
  
  try {
    console.log('\n🔄 Backfilling owner_discord_id and owner_name for cNFTs...\n');
    
    // Update all cNFTs that have owner_wallet but missing owner_discord_id
    const updateResult = await client.query(
      `
        UPDATE nft_metadata nm
        SET 
          owner_discord_id = uw.discord_id,
          owner_name = uw.discord_name
        FROM user_wallets uw
        WHERE nm.symbol LIKE 'seedling_%'
        AND nm.owner_wallet = uw.wallet_address
        AND (nm.owner_discord_id IS NULL OR nm.owner_discord_id = '')
      `
    );
    
    console.log(`✅ Updated ${updateResult.rowCount} cNFTs with owner_discord_id and owner_name`);
    
    // Also update cNFTs that have owner_discord_id but missing owner_name
    const updateNameResult = await client.query(
      `
        UPDATE nft_metadata nm
        SET owner_name = uw.discord_name
        FROM user_wallets uw
        WHERE nm.symbol LIKE 'seedling_%'
        AND nm.owner_wallet = uw.wallet_address
        AND nm.owner_discord_id = uw.discord_id
        AND (nm.owner_name IS NULL OR nm.owner_name = '')
      `
    );
    
    console.log(`✅ Updated ${updateNameResult.rowCount} cNFTs with owner_name`);
    
    // Get stats
    const statsResult = await client.query(
      `
        SELECT 
          COUNT(*) FILTER (WHERE symbol LIKE 'seedling_%' AND owner_discord_id IS NOT NULL) as linked_count,
          COUNT(*) FILTER (WHERE symbol LIKE 'seedling_%' AND (owner_discord_id IS NULL OR owner_discord_id = '')) as unlinked_count,
          COUNT(*) FILTER (WHERE symbol LIKE 'seedling_%') as total_cnfts
        FROM nft_metadata
      `
    );
    
    const stats = statsResult.rows[0];
    console.log(`\n📊 cNFT Ownership Stats:`);
    console.log(`   Total cNFTs: ${stats.total_cnfts}`);
    console.log(`   Linked to Discord: ${stats.linked_count}`);
    console.log(`   Unlinked: ${stats.unlinked_count}`);
    
    console.log(`\n✅ Backfill completed!\n`);
    
  } catch (error) {
    console.error('❌ Error during backfill:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

backfillCnftOwners()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

