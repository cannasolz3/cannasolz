#!/usr/bin/env node
/**
 * Script to query cNFT collection using Helius DAS API
 * Usage: node scripts/query-cnft-collection.mjs <collection_address>
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

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const COLLECTION_ADDRESS = process.argv[2] || 'BwhkoBJ9LB83fnRsPhG8utX7zCLYxhKjaabxtRDy2FPn';

if (!HELIUS_API_KEY) {
  console.error('ERROR: HELIUS_API_KEY environment variable is not set');
  console.error('Please set it in config/.env');
  process.exit(1);
}

if (!COLLECTION_ADDRESS) {
  console.error('ERROR: Collection address not provided');
  console.error('Usage: node scripts/query-cnft-collection.mjs <collection_address>');
  process.exit(1);
}

console.log(`\n🔍 Querying cNFT collection: ${COLLECTION_ADDRESS}\n`);

async function fetchCollectionNFTs(collectionAddress) {
  try {
    let allNFTs = [];
    let page = 1;
    const PAGE_SIZE = 1000; // Helius max page size
    let hasMore = true;

    while (hasMore) {
      console.log(`📄 Fetching page ${page}... (${allNFTs.length} NFTs found so far)`);
      
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
        console.log(`\n✅ No more items found. Total: ${allNFTs.length} NFTs`);
        hasMore = false;
        break;
      }

      // Log sample NFT from first page
      if (page === 1 && items.length > 0) {
        const firstNFT = items[0];
        console.log(`\n📦 Sample NFT (first item):`);
        console.log(`   ID: ${firstNFT.id}`);
        console.log(`   Name: ${firstNFT.content?.metadata?.name || 'N/A'}`);
        console.log(`   Owner: ${firstNFT.ownership?.owner || 'N/A'}`);
        console.log(`   Compressed: ${firstNFT.compression?.compressed ? 'Yes ✅' : 'No ❌'}`);
        console.log(`   Tree: ${firstNFT.compression?.tree || 'N/A'}`);
        console.log(`   Data Hash: ${firstNFT.compression?.data_hash || 'N/A'}`);
        console.log(`   Creator Hash: ${firstNFT.compression?.creator_hash || 'N/A'}`);
        console.log(`   Leaf ID: ${firstNFT.compression?.leaf_id || 'N/A'}`);
      }

      allNFTs.push(...items);
      
      // Add delay between requests to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
      
      page++;
    }

    return allNFTs;
  } catch (error) {
    console.error(`❌ Error fetching collection NFTs:`, error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    return [];
  }
}

async function main() {
  try {
    const nfts = await fetchCollectionNFTs(COLLECTION_ADDRESS);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 COLLECTION SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Collection Address: ${COLLECTION_ADDRESS}`);
    console.log(`Total NFTs Found: ${nfts.length}`);
    
    if (nfts.length > 0) {
      const compressedCount = nfts.filter(nft => nft.compression?.compressed).length;
      const regularCount = nfts.length - compressedCount;
      
      console.log(`\n📈 Breakdown:`);
      console.log(`   Compressed NFTs (cNFTs): ${compressedCount}`);
      console.log(`   Regular NFTs: ${regularCount}`);
      
      // Get unique owners
      const owners = new Set(nfts.map(nft => nft.ownership?.owner).filter(Boolean));
      console.log(`   Unique Owners: ${owners.size}`);
      
      // Sample a few NFTs
      console.log(`\n📋 Sample NFTs (first 5):`);
      nfts.slice(0, 5).forEach((nft, idx) => {
        console.log(`\n   ${idx + 1}. ${nft.content?.metadata?.name || 'Unnamed'}`);
        console.log(`      ID: ${nft.id}`);
        console.log(`      Owner: ${nft.ownership?.owner || 'N/A'}`);
        console.log(`      Type: ${nft.compression?.compressed ? 'cNFT ✅' : 'Regular NFT'}`);
        if (nft.compression?.compressed) {
          console.log(`      Leaf ID: ${nft.compression.leaf_id || 'N/A'}`);
        }
      });
    }
    
    console.log(`\n${'='.repeat(60)}\n`);
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();

