#!/usr/bin/env node
/**
 * Script to sync all 5 cNFT seedling collections to database
 * Tracks ownership and assigns HARVESTER Discord roles
 */

import axios from 'axios';
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

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const POSTGRES_URL = process.env.POSTGRES_URL;

if (!HELIUS_API_KEY) {
  console.error('ERROR: HELIUS_API_KEY environment variable is not set');
  process.exit(1);
}

if (!POSTGRES_URL) {
  console.error('ERROR: POSTGRES_URL environment variable is not set');
  process.exit(1);
}

// Collection definitions
const COLLECTIONS = [
  {
    name: 'Gold',
    symbol: 'seedling_gold',
    collectionAddress: 'BwhkoBJ9LB83fnRsPhG8utX7zCLYxhKjaabxtRDy2FPn',
    roleId: '1260017043005112330',
    color: 'd5ba46'
  },
  {
    name: 'Silver',
    symbol: 'seedling_silver',
    collectionAddress: '2vaqE6o2SbeWhwgfpNMXWSbe1FCofXEYHRx3BXTopT72',
    roleId: '1260016966324846592',
    color: '9aaaaa'
  },
  {
    name: 'Purple',
    symbol: 'seedling_purple',
    collectionAddress: '8aQVCm1bF5prDaEi2HN7VVRjEx7pHDLMkLz1KMiL4CfG',
    roleId: '1260016886587068556',
    color: '9b59b6'
  },
  {
    name: 'Dark Green',
    symbol: 'seedling_dark_green',
    collectionAddress: 'GyjJuhKuPVVmBEWgaQfhoF96ySrjJJD1oAHyqsWb43HB',
    roleId: '1260016258087387297',
    color: '004a1f'
  },
  {
    name: 'Light Green',
    symbol: 'seedling_light_green',
    collectionAddress: 'B7P39nJk6GrwosqPMt1vUCp3GFjYbaBNa9UUA1qn7iRw',
    roleId: '1248728576770048140',
    color: '6bfb7d'
  }
];

async function fetchCollectionNFTs(collectionAddress) {
  try {
    let allNFTs = [];
    let page = 1;
    const PAGE_SIZE = 1000;
    let hasMore = true;

    while (hasMore) {
      const requestBody = {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getAssetsByGroup',
        params: {
          groupKey: 'collection',
          groupValue: collectionAddress,
          page,
          limit: PAGE_SIZE
        }
      };
      
      const response = await axios.post(
        `https://rpc.helius.xyz/?api-key=${HELIUS_API_KEY}`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.error) {
        console.error(`❌ Helius API error:`, response.data.error);
        throw new Error(`Helius API error: ${response.data.error.message}`);
      }

      const items = response.data.result?.items || [];
      
      if (!items || items.length === 0) {
        hasMore = false;
        break;
      }

      allNFTs.push(...items);
      await new Promise(resolve => setTimeout(resolve, 500));
      page++;
    }

    return allNFTs;
  } catch (error) {
    console.error(`❌ Error fetching collection NFTs:`, error.message);
    return [];
  }
}

async function syncCollection(pool, collection) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🌱 Syncing ${collection.name} Collection`);
  console.log(`${'='.repeat(60)}`);
  
  const client = await pool.connect();
  
  try {
    // Fetch all cNFTs from collection
    console.log(`📡 Fetching cNFTs from collection...`);
    const nfts = await fetchCollectionNFTs(collection.collectionAddress);
    console.log(`✅ Found ${nfts.length} cNFTs`);
    
    if (nfts.length === 0) {
      console.log(`⚠️  No NFTs found, skipping...`);
      return { inserted: 0, updated: 0, owners: new Set() };
    }
    
    let inserted = 0;
    let updated = 0;
    const owners = new Set();
    
    // Insert/update each cNFT
    for (const nft of nfts) {
      const owner = nft.ownership?.owner;
      if (owner) {
        owners.add(owner);
      }
      
      const name = nft.content?.metadata?.name || `NFT #${nft.compression?.leaf_id || 'Unknown'}`;
      const imageUrl = nft.content?.links?.image || nft.content?.files?.[0]?.cdn_uri || null;
      
      // Check if cNFT already exists
      const existing = await client.query(
        'SELECT mint_address FROM nft_metadata WHERE mint_address = $1',
        [nft.id]
      );
      
      if (existing.rows.length === 0) {
        // Insert new cNFT
        await client.query(
          `INSERT INTO nft_metadata (
            mint_address,
            name,
            symbol,
            owner_wallet,
            image_url,
            is_listed,
            rarity_rank
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (mint_address) DO UPDATE SET
            name = EXCLUDED.name,
            symbol = EXCLUDED.symbol,
            owner_wallet = EXCLUDED.owner_wallet,
            image_url = COALESCE(EXCLUDED.image_url, nft_metadata.image_url)`,
          [
            nft.id,
            name,
            collection.symbol,
            owner || null,
            imageUrl,
            false,
            null
          ]
        );
        inserted++;
      } else {
        // Update existing cNFT
        await client.query(
          `UPDATE nft_metadata SET
            name = $1,
            owner_wallet = $2,
            image_url = COALESCE($3, image_url)
          WHERE mint_address = $4`,
          [name, owner || null, imageUrl, nft.id]
        );
        updated++;
      }
    }
    
    console.log(`✅ Inserted: ${inserted}, Updated: ${updated}`);
    console.log(`👥 Unique owners: ${owners.size}`);
    
    return { inserted, updated, owners };
    
  } catch (error) {
    console.error(`❌ Error syncing ${collection.name}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function updateUserRoles(pool) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎭 Updating User Roles Based on cNFT Ownership`);
  console.log(`${'='.repeat(60)}`);
  
  const client = await pool.connect();
  
  try {
    // For each collection, find all wallet owners and link to Discord IDs
    for (const collection of COLLECTIONS) {
      console.log(`\n🔍 Processing ${collection.name} collection...`);
      
      // Get all wallets that own at least 1 cNFT from this collection
      const walletResult = await client.query(
        `SELECT DISTINCT owner_wallet 
         FROM nft_metadata 
         WHERE symbol = $1 AND owner_wallet IS NOT NULL`,
        [collection.symbol]
      );
      
      const wallets = walletResult.rows.map(r => r.owner_wallet);
      console.log(`   Found ${wallets.length} unique wallet owners`);
      
      if (wallets.length === 0) continue;
      
      // Find Discord IDs for these wallets
      const discordResult = await client.query(
        `SELECT DISTINCT discord_id 
         FROM user_wallets 
         WHERE wallet_address = ANY($1::text[]) AND discord_id IS NOT NULL`,
        [wallets]
      );
      
      const discordIds = discordResult.rows.map(r => r.discord_id);
      console.log(`   Found ${discordIds.length} linked Discord accounts`);
      
      if (discordIds.length === 0) continue;
      
      // Update user_roles to mark eligibility for HARVESTER role
      // We'll add a flag like `harvester_gold`, `harvester_silver`, etc.
      const roleFlag = `harvester_${collection.symbol.replace('seedling_', '')}`;
      
      for (const discordId of discordIds) {
        // Check if user_roles row exists
        const userCheck = await client.query(
          'SELECT discord_id FROM user_roles WHERE discord_id = $1',
          [discordId]
        );
        
        if (userCheck.rows.length === 0) {
          // Create user_roles row
          await client.query(
            `INSERT INTO user_roles (discord_id, ${roleFlag}) 
             VALUES ($1, TRUE)`,
            [discordId]
          );
        } else {
          // Update existing row
          await client.query(
            `UPDATE user_roles SET ${roleFlag} = TRUE WHERE discord_id = $1`,
            [discordId]
          );
        }
      }
      
      console.log(`   ✅ Updated ${discordIds.length} users with ${collection.name} HARVESTER eligibility`);
    }
    
  } catch (error) {
    console.error(`❌ Error updating user roles:`, error);
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = new Pool({
    connectionString: POSTGRES_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🌱 CannaSolz cNFT Collection Sync`);
    console.log(`${'='.repeat(60)}\n`);
    
    // First, ensure the role flags exist in user_roles table
    const client = await pool.connect();
    try {
      console.log(`🔧 Checking/Adding role columns to user_roles table...`);
      
      const roleFlags = [
        'harvester_gold',
        'harvester_silver',
        'harvester_purple',
        'harvester_dark_green',
        'harvester_light_green'
      ];
      
      for (const flag of roleFlags) {
        try {
          await client.query(`ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS ${flag} BOOLEAN DEFAULT FALSE`);
          console.log(`   ✅ Column ${flag} exists or created`);
        } catch (error) {
          if (error.code !== '42701') { // Column already exists
            console.error(`   ⚠️  Error with ${flag}:`, error.message);
          }
        }
      }
    } finally {
      client.release();
    }
    
    // Sync each collection
    const results = [];
    for (const collection of COLLECTIONS) {
      const result = await syncCollection(pool, collection);
      results.push({ collection: collection.name, ...result });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Update user roles based on ownership
    await updateUserRoles(pool);
    
    // Print summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 SYNC SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    results.forEach(r => {
      console.log(`${r.collection}: ${r.inserted} inserted, ${r.updated} updated, ${r.owners.size} owners`);
    });
    console.log(`\n✅ Sync completed successfully!\n`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

