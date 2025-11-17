// cNFT Collections Sync - Incremental updates for seedling collections
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pkg from 'pg';
const { Pool } = pkg;
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: `${__dirname}/.env` });

// Collection definitions
const COLLECTIONS = [
  {
    name: 'Gold',
    symbol: 'seedling_gold',
    collectionAddress: 'BwhkoBJ9LB83fnRsPhG8utX7zCLYxhKjaabxtRDy2FPn',
    roleId: '1260017043005112330',
    color: '#d5ba46'
  },
  {
    name: 'Silver',
    symbol: 'seedling_silver',
    collectionAddress: '2vaqE6o2SbeWhwgfpNMXWSbe1FCofXEYHRx3BXTopT72',
    roleId: '1260016966324846592',
    color: '#9aaaaa'
  },
  {
    name: 'Purple',
    symbol: 'seedling_purple',
    collectionAddress: '8aQVCm1bF5prDaEi2HN7VVRjEx7pHDLMkLz1KMiL4CfG',
    roleId: '1260016886587068556',
    color: '#9b59b6'
  },
  {
    name: 'Dark Green',
    symbol: 'seedling_dark_green',
    collectionAddress: 'GyjJuhKuPVVmBEWgaQfhoF96ySrjJJD1oAHyqsWb43HB',
    roleId: '1260016258087387297',
    color: '#004a1f'
  },
  {
    name: 'Light Green',
    symbol: 'seedling_light_green',
    collectionAddress: 'B7P39nJk6GrwosqPMt1vUCp3GFjYbaBNa9UUA1qn7iRw',
    roleId: '1248728576770048140',
    color: '#6bfb7d'
  }
];

// Function to fetch all cNFTs from a collection (incremental - only new ones)
async function fetchCollectionNFTs(collectionAddress) {
  try {
    if (!process.env.HELIUS_API_KEY) {
      throw new Error('HELIUS_API_KEY environment variable is not set');
    }

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
        `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.error) {
        console.error(`Helius API error:`, response.data.error);
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
    console.error(`Error fetching collection NFTs:`, error.message);
    return [];
  }
}

// Sync a single collection (incremental - only process new/changed NFTs)
async function syncCollection(pool, collection) {
  console.log(`\n🌱 Syncing ${collection.name} Collection (${collection.symbol})`);
  
  const client = await pool.connect();
  
  try {
    // Fetch all cNFTs from collection
    const nfts = await fetchCollectionNFTs(collection.collectionAddress);
    console.log(`   📡 Fetched ${nfts.length} cNFTs from chain`);
    
    if (nfts.length === 0) {
      console.log(`   ⚠️  No NFTs found, skipping...`);
      return { inserted: 0, updated: 0, owners: new Set() };
    }
    
    // Get existing cNFTs from database for this collection
    const existingResult = await client.query(
      `SELECT mint_address, owner_wallet FROM nft_metadata WHERE symbol = $1`,
      [collection.symbol]
    );
    const existingMap = new Map(existingResult.rows.map(r => [r.mint_address, r.owner_wallet]));
    console.log(`   💾 Found ${existingMap.size} existing cNFTs in database`);
    
    let inserted = 0;
    let updated = 0;
    const owners = new Set();
    
    // Process each cNFT
    for (const nft of nfts) {
      const owner = nft.ownership?.owner;
      if (owner) {
        owners.add(owner);
      }
      
      const name = nft.content?.metadata?.name || `NFT #${nft.compression?.leaf_id || 'Unknown'}`;
      const imageUrl = nft.content?.links?.image || nft.content?.files?.[0]?.cdn_uri || null;
      const existingOwner = existingMap.get(nft.id);
      
      // Get Discord ID and name for this wallet if linked
      let ownerDiscordId = null;
      let ownerName = null;
      if (owner) {
        const walletOwner = await client.query(
          `SELECT discord_id, discord_name FROM user_wallets WHERE wallet_address = $1 LIMIT 1`,
          [owner]
        );
        if (walletOwner.rows.length > 0) {
          ownerDiscordId = walletOwner.rows[0].discord_id;
          ownerName = walletOwner.rows[0].discord_name;
        }
      }
      
      if (!existingOwner) {
        // New cNFT - insert
        await client.query(
          `INSERT INTO nft_metadata (
            mint_address,
            name,
            symbol,
            owner_wallet,
            owner_discord_id,
            owner_name,
            image_url,
            is_listed,
            rarity_rank
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (mint_address) DO UPDATE SET
            name = EXCLUDED.name,
            symbol = EXCLUDED.symbol,
            owner_wallet = EXCLUDED.owner_wallet,
            owner_discord_id = COALESCE(EXCLUDED.owner_discord_id, nft_metadata.owner_discord_id),
            owner_name = COALESCE(EXCLUDED.owner_name, nft_metadata.owner_name),
            image_url = COALESCE(EXCLUDED.image_url, nft_metadata.image_url)`,
          [
            nft.id,
            name,
            collection.symbol,
            owner || null,
            ownerDiscordId,
            ownerName,
            imageUrl,
            false,
            null
          ]
        );
        inserted++;
      } else if (existingOwner !== owner) {
        // Ownership changed - update
        await client.query(
          `UPDATE nft_metadata SET
            owner_wallet = $1,
            owner_discord_id = $2,
            owner_name = $3,
            image_url = COALESCE($4, image_url)
          WHERE mint_address = $5`,
          [owner || null, ownerDiscordId, ownerName, imageUrl, nft.id]
        );
        updated++;
      } else if (owner && !ownerDiscordId) {
        // Same owner but check if we can now link Discord (backfill case)
        const walletOwner = await client.query(
          `SELECT discord_id, discord_name FROM user_wallets WHERE wallet_address = $1 LIMIT 1`,
          [owner]
        );
        if (walletOwner.rows.length > 0) {
          await client.query(
            `UPDATE nft_metadata SET
              owner_discord_id = $1,
              owner_name = $2
            WHERE mint_address = $3 AND (owner_discord_id IS NULL OR owner_discord_id = '')`,
            [walletOwner.rows[0].discord_id, walletOwner.rows[0].discord_name, nft.id]
          );
        }
      }
    }
    
    console.log(`   ✅ Inserted: ${inserted}, Updated: ${updated}, Total owners: ${owners.size}`);
    
    return { inserted, updated, owners };
    
  } catch (error) {
    console.error(`   ❌ Error syncing ${collection.name}:`, error);
    throw error;
  } finally {
    client.release();
  }
}

// Update user roles based on cNFT ownership
async function updateUserRoles(pool) {
  console.log(`\n🎭 Updating User Roles Based on cNFT Ownership`);
  
  const client = await pool.connect();
  
  try {
    // Ensure role columns exist
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
      } catch (error) {
        if (error.code !== '42701') { // Column already exists
          console.error(`   ⚠️  Error with ${flag}:`, error.message);
        }
      }
    }
    
    // For each collection, find all wallet owners and link to Discord IDs
    for (const collection of COLLECTIONS) {
      // Get all wallets that own at least 1 cNFT from this collection
      const walletResult = await client.query(
        `SELECT DISTINCT owner_wallet 
         FROM nft_metadata 
         WHERE symbol = $1 AND owner_wallet IS NOT NULL`,
        [collection.symbol]
      );
      
      const wallets = walletResult.rows.map(r => r.owner_wallet);
      
      if (wallets.length === 0) continue;
      
      // Find Discord IDs for these wallets
      const discordResult = await client.query(
        `SELECT DISTINCT discord_id 
         FROM user_wallets 
         WHERE wallet_address = ANY($1::text[]) AND discord_id IS NOT NULL`,
        [wallets]
      );
      
      const discordIds = discordResult.rows.map(r => r.discord_id);
      
      if (discordIds.length === 0) continue;
      
      // Update user_roles to mark eligibility for HARVESTER role
      const roleFlag = `harvester_${collection.symbol.replace('seedling_', '')}`;
      
      // Set flag to TRUE for users who own cNFTs
      for (const discordId of discordIds) {
        const userCheck = await client.query(
          'SELECT discord_id FROM user_roles WHERE discord_id = $1',
          [discordId]
        );
        
        if (userCheck.rows.length === 0) {
          await client.query(
            `INSERT INTO user_roles (discord_id, ${roleFlag}) 
             VALUES ($1, TRUE)`,
            [discordId]
          );
        } else {
          await client.query(
            `UPDATE user_roles SET ${roleFlag} = TRUE WHERE discord_id = $1`,
            [discordId]
          );
        }
      }
      
      // Set flag to FALSE for users who no longer own cNFTs (but have linked wallets)
      const allDiscordIds = await client.query(
        `SELECT DISTINCT discord_id FROM user_wallets WHERE discord_id IS NOT NULL`
      );
      
      for (const row of allDiscordIds.rows) {
        const discordId = row.discord_id;
        const userWallets = await client.query(
          `SELECT wallet_address FROM user_wallets WHERE discord_id = $1`,
          [discordId]
        );
        
        if (userWallets.rows.length > 0) {
          const walletAddresses = userWallets.rows.map(r => r.wallet_address);
          const ownsCnft = await client.query(
            `SELECT COUNT(*) as count 
             FROM nft_metadata 
             WHERE symbol = $1 AND owner_wallet = ANY($2::text[])`,
            [collection.symbol, walletAddresses]
          );
          
          if (Number(ownsCnft.rows[0]?.count || 0) === 0) {
            // User no longer owns any cNFTs from this collection
            await client.query(
              `UPDATE user_roles SET ${roleFlag} = FALSE WHERE discord_id = $1`,
              [discordId]
            );
          }
        }
      }
      
      console.log(`   ✅ Updated ${discordIds.length} users with ${collection.name} HARVESTER eligibility`);
    }
    
    // Update collection_counts to include cNFTs for all users with linked wallets
    console.log(`\n📊 Updating collection_counts with cNFT data...`);
    
    // Get all users with linked wallets
    const allUsersResult = await client.query(
      `SELECT DISTINCT discord_id FROM user_wallets WHERE discord_id IS NOT NULL`
    );
    
    let updatedCount = 0;
    for (const userRow of allUsersResult.rows) {
      const discordId = userRow.discord_id;
      
      // Get user's wallets
      const userWallets = await client.query(
        `SELECT wallet_address FROM user_wallets WHERE discord_id = $1`,
        [discordId]
      );
      
      if (userWallets.rows.length === 0) continue;
      
      const walletAddresses = userWallets.rows.map(r => r.wallet_address);
      
      // Recalculate collection_counts including cNFTs
      await client.query(
        `
          INSERT INTO collection_counts (
            discord_id, discord_name,
            gold_count, silver_count, purple_count, dark_green_count, light_green_count,
            og420_count, total_count, last_updated
          )
          SELECT
            $1::varchar AS discord_id,
            COALESCE((SELECT discord_name FROM collection_counts WHERE discord_id = $1), '') AS discord_name,
            -- Regular NFTs by leaf_colour + cNFTs by symbol
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Gold' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) +
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_gold') AS gold_count,
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Silver' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) +
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_silver') AS silver_count,
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Purple' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) +
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_purple') AS purple_count,
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Dark green' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) +
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_dark_green') AS dark_green_count,
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Light green' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) +
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_light_green') AS light_green_count,
            COUNT(*) FILTER (WHERE nm.og420 = TRUE) AS og420_count,
            COUNT(*) AS total_count,
            NOW() AS last_updated
          FROM nft_metadata nm
          WHERE nm.owner_wallet = ANY($2::text[])
          ON CONFLICT (discord_id) DO UPDATE SET
            gold_count = EXCLUDED.gold_count,
            silver_count = EXCLUDED.silver_count,
            purple_count = EXCLUDED.purple_count,
            dark_green_count = EXCLUDED.dark_green_count,
            light_green_count = EXCLUDED.light_green_count,
            og420_count = EXCLUDED.og420_count,
            total_count = EXCLUDED.total_count,
            last_updated = NOW()
        `,
        [discordId, walletAddresses]
      );
      updatedCount++;
    }
    
    console.log(`   ✅ Updated collection_counts for ${updatedCount} users (including cNFTs)`);
    
    // Backfill owner_discord_id and owner_name for cNFTs
    console.log(`\n🔗 Backfilling owner_discord_id and owner_name for cNFTs...`);
    const backfillResult = await client.query(
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
    console.log(`   ✅ Backfilled ${backfillResult.rowCount} cNFTs with owner information`);
    
    // Update daily_rewards to include cNFT rewards
    console.log(`\n💰 Updating daily_rewards with cNFT rewards...`);
    
    // cNFT yield rates
    const cnftYieldRates = {
      seedling_gold: 5,
      seedling_silver: 4,
      seedling_purple: 3,
      seedling_dark_green: 2,
      seedling_light_green: 1
    };
    
    // For each user with linked wallets, calculate their cNFT daily reward
    const allUsers = await client.query(
      `SELECT DISTINCT discord_id FROM user_wallets WHERE discord_id IS NOT NULL`
    );
    
    for (const userRow of allUsers.rows) {
      const discordId = userRow.discord_id;
      
      // Get user's wallets
      const userWallets = await client.query(
        `SELECT wallet_address FROM user_wallets WHERE discord_id = $1`,
        [discordId]
      );
      
      if (userWallets.rows.length === 0) continue;
      
      const walletAddresses = userWallets.rows.map(r => r.wallet_address);
      
      // Calculate cNFT daily reward
      const cnftRewardResult = await client.query(
        `
          SELECT 
            COALESCE(SUM(
              CASE symbol
                WHEN 'seedling_gold' THEN $1
                WHEN 'seedling_silver' THEN $2
                WHEN 'seedling_purple' THEN $3
                WHEN 'seedling_dark_green' THEN $4
                WHEN 'seedling_light_green' THEN $5
                ELSE 0
              END
            ), 0) as cnft_daily_reward
          FROM nft_metadata
          WHERE symbol LIKE 'seedling_%'
          AND owner_wallet = ANY($6::text[])
        `,
        [
          cnftYieldRates.seedling_gold,
          cnftYieldRates.seedling_silver,
          cnftYieldRates.seedling_purple,
          cnftYieldRates.seedling_dark_green,
          cnftYieldRates.seedling_light_green,
          walletAddresses
        ]
      );
      
      const cnftDailyReward = Number(cnftRewardResult.rows[0]?.cnft_daily_reward || 0);
      
      // Update daily_rewards - ensure row exists first, then add cNFT rewards
      // Check if daily_rewards row exists
      const dailyRewardsCheck = await client.query(
        'SELECT discord_id, total_daily_reward FROM daily_rewards WHERE discord_id = $1',
        [discordId]
      );
      
      if (dailyRewardsCheck.rows.length === 0) {
        // Create daily_rewards row if it doesn't exist
        // First calculate NFT rewards
        const countsResult = await client.query(
          `SELECT 
            COALESCE(gold_count, 0) * 30 +
            COALESCE(silver_count, 0) * 25 +
            COALESCE(purple_count, 0) * 20 +
            COALESCE(dark_green_count, 0) * 15 +
            COALESCE(light_green_count, 0) * 10 +
            COALESCE(og420_count, 0) * 50 as nft_reward
          FROM collection_counts WHERE discord_id = $1`,
          [discordId]
        );
        const nftReward = Number(countsResult.rows[0]?.nft_reward || 0);
        
        await client.query(
          `INSERT INTO daily_rewards (discord_id, total_daily_reward)
           VALUES ($1, $2)`,
          [discordId, nftReward + cnftDailyReward]
        );
      } else {
        // Update existing row - recalculate total (NFT + cNFT)
        const countsResult = await client.query(
          `SELECT 
            COALESCE(gold_count, 0) * 30 +
            COALESCE(silver_count, 0) * 25 +
            COALESCE(purple_count, 0) * 20 +
            COALESCE(dark_green_count, 0) * 15 +
            COALESCE(light_green_count, 0) * 10 +
            COALESCE(og420_count, 0) * 50 as nft_reward
          FROM collection_counts WHERE discord_id = $1`,
          [discordId]
        );
        const nftReward = Number(countsResult.rows[0]?.nft_reward || 0);
        
        await client.query(
          `UPDATE daily_rewards
           SET total_daily_reward = $1
           WHERE discord_id = $2`,
          [nftReward + cnftDailyReward, discordId]
        );
      }
    }
    
    console.log(`   ✅ Updated daily_rewards for all users with cNFT holdings`);
    
  } catch (error) {
    console.error(`   ❌ Error updating user roles:`, error);
    throw error;
  } finally {
    client.release();
  }
}

// Main sync function
export default async function syncAllCnftCollections() {
  if (!process.env.HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY environment variable is required');
  }

  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL environment variable is required');
  }

  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🌱 CannaSolz cNFT Collection Sync (Incremental)`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Sync each collection
    const results = [];
    for (const collection of COLLECTIONS) {
      const result = await syncCollection(pool, collection);
      results.push({ collection: collection.name, ...result });
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Update user roles based on ownership
    await updateUserRoles(pool);
    
    // Print summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 SYNC SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    results.forEach(r => {
      console.log(`${r.collection}: ${r.inserted} new, ${r.updated} updated, ${r.owners.size} owners`);
    });
    console.log(`\n✅ cNFT sync completed successfully!\n`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncAllCnftCollections()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

