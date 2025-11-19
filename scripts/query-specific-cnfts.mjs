// Query specific cNFT mint addresses and add to database
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pkg from 'pg';
const { Pool } = pkg;
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: `${__dirname}/../packages/monitoring/.env` });

// The specific mint addresses to query
const MINT_ADDRESSES = [
  'D5ryzRaYPQJwAAUWYj4SwDKAJEdyX2DwtKwgnG1D2L1z',
  'BNwTXky65vWfoCp8Sp5cYb7D75re6krWzEZSeU99m8Sw',
  'FGrFpaRf6g4s9qkFzhMJWmKYnNwLDDWjcrNCCyaSqkpp',
  'FCw96nfpDxapZtW5NNU5ekzEVXrrQ1MNCmfvzbds7eHw',
  'Bw3na4ccewqggfqCNBERGdGbC4xQrSgwxSXuEK5mU5Ly',
  '8Kmj8D2SLMibF8frzp4Hk6E4BQPs9agEHVLpJyVNPBsU'
];

// Collection definitions to match symbols
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
    collectionAddress: 'B7P39nJk6GrwosPmt1vUCp3GFjYbaBNa9UUA1qn7iRw',
    roleId: '1248728576770048140',
    color: '#6bfb7d'
  }
];

async function queryMintAddress(mintAddress) {
  try {
    const requestBody = {
      jsonrpc: '2.0',
      id: 'my-id',
      method: 'getAsset',
      params: {
        id: mintAddress
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
      console.error(`Error querying ${mintAddress}:`, response.data.error);
      return null;
    }

    return response.data.result;
  } catch (error) {
    console.error(`Error fetching ${mintAddress}:`, error.message);
    return null;
  }
}

async function findCollectionForNFT(nft) {
  // Check if NFT has group information
  const groups = nft?.grouping || [];
  for (const group of groups) {
    if (group.group_key === 'collection') {
      const collectionAddress = group.group_value;
      const collection = COLLECTIONS.find(c => c.collectionAddress === collectionAddress);
      if (collection) {
        return collection;
      }
    }
  }
  return null;
}

async function main() {
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

  const client = await pool.connect();

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 Querying ${MINT_ADDRESSES.length} specific cNFT mint addresses`);
    console.log(`${'='.repeat(60)}\n`);

    let found = 0;
    let inserted = 0;
    let updated = 0;
    let notFound = 0;

    for (const mintAddress of MINT_ADDRESSES) {
      console.log(`\n📋 Querying: ${mintAddress}`);
      
      const nft = await queryMintAddress(mintAddress);
      
      if (!nft) {
        console.log(`   ❌ Not found in Helius API`);
        notFound++;
        continue;
      }

      found++;
      console.log(`   ✅ Found in Helius API`);
      console.log(`   Name: ${nft.content?.metadata?.name || 'Unknown'}`);
      console.log(`   Owner: ${nft.ownership?.owner || 'Unknown'}`);

      // Find which collection this belongs to
      const collection = await findCollectionForNFT(nft);
      
      if (!collection) {
        console.log(`   ⚠️  Could not determine collection - checking groups...`);
        const groups = nft?.grouping || [];
        console.log(`   Groups:`, JSON.stringify(groups, null, 2));
        continue;
      }

      console.log(`   📦 Collection: ${collection.name} (${collection.symbol})`);

      const owner = nft.ownership?.owner;
      const name = nft.content?.metadata?.name || `NFT #${nft.compression?.leaf_id || 'Unknown'}`;
      const imageUrl = nft.content?.links?.image || nft.content?.files?.[0]?.cdn_uri || null;

      // Check if already in database
      const existing = await client.query(
        `SELECT mint_address, owner_wallet, symbol FROM nft_metadata WHERE mint_address = $1`,
        [mintAddress]
      );

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
          console.log(`   👤 Linked to Discord: ${ownerName} (${ownerDiscordId})`);
        }
      }

      if (existing.rows.length === 0) {
        // Insert new
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
            mintAddress,
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
        console.log(`   ✅ Inserted into database`);
      } else {
        // Update existing
        const existingRow = existing.rows[0];
        if (existingRow.owner_wallet !== owner || existingRow.symbol !== collection.symbol) {
          await client.query(
            `UPDATE nft_metadata SET
              owner_wallet = $1,
              owner_discord_id = $2,
              owner_name = $3,
              symbol = $4,
              image_url = COALESCE($5, image_url)
            WHERE mint_address = $6`,
            [owner || null, ownerDiscordId, ownerName, collection.symbol, imageUrl, mintAddress]
          );
          updated++;
          console.log(`   ✅ Updated in database`);
        } else {
          console.log(`   ℹ️  Already in database with correct data`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Found in API: ${found}`);
    console.log(`Inserted: ${inserted}`);
    console.log(`Updated: ${updated}`);
    console.log(`Not found: ${notFound}`);
    console.log(`\n✅ Query completed!\n`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

