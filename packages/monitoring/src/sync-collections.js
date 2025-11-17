// Generic NFT Collections Sync
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import pkg from 'pg';
const { Pool } = pkg;
import axios from 'axios';
import collections from './collections.config.js';
import { sendActivityNotification } from './api/integrations/discord/notifications.js';
import { syncUserRoles } from '../../backend/src/api/integrations/discord/roles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: `${__dirname}/.env` });

// Add test mode flag
const TEST_MODE = process.env.TEST_MODE === 'true';

// Marketplace escrow wallets
const MARKETPLACE_ESCROWS = {
  MAGICEDEN: { id: '1BWutmTvYPwDtmw9abTkS4Ssr8no61spGAvW1X6NDix', name: 'Magic Eden' },
  TENSOR: { id: '4zdNGgAtFsW1cQgHqkiWyRsxaAgxrSRRynnuunxzjxue', name: 'Tensor' }
};

// Create sets for easier lookup
const ESCROW_WALLETS = new Set(Object.values(MARKETPLACE_ESCROWS).map(m => m.id));

function getMarketplaceName(address) {
  const marketplace = Object.values(MARKETPLACE_ESCROWS).find(m => m.id === address);
  return marketplace ? marketplace.name : 'Unknown';
}

// Function to fetch all NFTs in the collection
async function fetchCollectionNFTs(collection) {
  try {
    if (!process.env.HELIUS_API_KEY) {
      throw new Error('HELIUS_API_KEY environment variable is not set');
    }

    console.log(`\nFetching NFTs for ${collection.name} (${collection.address})...`);

    let allNFTs = [];
    let page = 1;
    const PAGE_SIZE = 1000; // Helius max page size
    let hasMore = true;

    while (hasMore) {
      console.log(`\nFetching page ${page} for ${collection.name} (${allNFTs.length} NFTs so far)`);
      
      const requestBody = {
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getAssetsByGroup',
        params: {
          groupKey: 'collection',
          groupValue: collection.address,
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
        console.error(`Helius API error for ${collection.name}:`, response.data.error);
        throw new Error(`Helius API error: ${response.data.error.message}`);
      }

      const items = response.data.result.items;
      if (!items || items.length === 0) {
        console.log(`No more items found for ${collection.name}`);
        hasMore = false;
        break;
      }

      // Log first NFT of each page for debugging
      if (items.length > 0) {
        const firstNFT = items[0];
        console.log(`Sample NFT from page ${page}:`, {
          mint: firstNFT.id,
          name: firstNFT.content.metadata.name,
          owner: firstNFT.ownership.owner,
          collection: collection.name
        });
      }

      allNFTs.push(...items);
      
      // Add delay between requests to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
      
      page++;
    }

    console.log(`\nFetched total of ${allNFTs.length} NFTs for ${collection.name}`);
    return allNFTs;
  } catch (error) {
    console.error(`Error fetching collection NFTs for ${collection.address}:`, error);
    return [];
  }
}

// Function to determine the type of ownership change
async function determineOwnershipChange(mintAddress, oldOwner, newOwner) {
  try {
    // Normalize wallet addresses for comparison
    const normalizedOldOwner = oldOwner.toLowerCase();
    const normalizedNewOwner = newOwner.toLowerCase();
    
    // Check if the NFT was burned (no owner)
    if (!newOwner) {
      return { 
        type: 'burned',
        details: {
          previous_owner: oldOwner,
          timestamp: new Date().toISOString()
        }
      };
    }
    
    // Check if the NFT is listed on Magic Eden or Tensor
    const isListed = normalizedNewOwner === '1bwutmtvypwdtmw9abtk4ssr8no61spgavw1x6ndix' || 
                    normalizedNewOwner === '4zdnggatfsw1cqghqkiwyrsxaagxrsrrnnuunxzjxue';
    
    if (isListed) {
      console.log(`\nFetching transaction history for ${mintAddress} to get list price...`);
      
      // Fetch transaction history to get list price
      const response = await fetch(
        `https://api.helius.xyz/v0/addresses/${mintAddress}/transactions?api-key=${process.env.HELIUS_API_KEY}`
      );
      
      if (!response.ok) {
        console.error(`Failed to fetch transaction history: ${response.statusText}`);
        throw new Error(`Failed to fetch transaction history: ${response.statusText}`);
      }
      
      const transactions = await response.json();
      console.log(`Found ${transactions.length} transactions`);
      
      // Find the most recent listing transaction
      const listingTx = transactions.find(tx => {
        // Log transaction details for debugging
        console.log('Checking transaction:', {
          type: tx.type,
          hasEvents: !!tx.events,
          events: tx.events?.map(e => e.type)
        });
        
        // Check for NFT_LISTING event or TSWAP program
        return tx.type === 'NFT_LISTING' || 
               (tx.events?.some(event => event.type === 'NFT_LISTING')) ||
               (tx.events?.some(event => event.programId === 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN'));
      });
      
      if (listingTx) {
        console.log('Found listing transaction:', listingTx);
        
        // Extract list price from listing transaction
        let listPrice = null;
        let marketplace = normalizedNewOwner === '1bwutmtvypwdtmw9abtk4ssr8no61spgavw1x6ndix' ? 'Magic Eden' : 'Tensor';
        
        // Try to get price from events first
        if (listingTx.events) {
          const listingEvent = listingTx.events.find(event => event.type === 'NFT_LISTING');
          if (listingEvent) {
            listPrice = listingEvent.amount / 1e9; // Convert lamports to SOL
            marketplace = listingEvent.source || marketplace;
            console.log('Found list price from events:', listPrice, 'SOL');
          }
        }
        
        // If no price in events, try to get from transaction description
        if (!listPrice && listingTx.description) {
          const priceMatch = listingTx.description.match(/(\d+\.?\d*)\s*SOL/);
          if (priceMatch) {
            listPrice = parseFloat(priceMatch[1]);
            console.log('Found list price from description:', listPrice, 'SOL');
          }
        }
        
        // If still no price, try to get from balance changes
        if (!listPrice && listingTx.tokenTransfers) {
          const transfer = listingTx.tokenTransfers.find(t => t.mint === mintAddress);
          if (transfer && transfer.amount) {
            listPrice = transfer.amount / 1e9;
            console.log('Found list price from token transfer:', listPrice, 'SOL');
          }
        }

        // For Tensor listings, try to decode the program data
        if (!listPrice && marketplace === 'Tensor' && listingTx.events) {
          const tensorEvent = listingTx.events.find(event => 
            event.programId === 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN'
          );
          
          if (tensorEvent && tensorEvent.data) {
            try {
              // Decode base64 data
              const decodedData = Buffer.from(tensorEvent.data, 'base64');
              // Price is in bytes 16-23
              const priceBytes = decodedData.slice(16, 24);
              const priceLamports = priceBytes.readBigUInt64LE();
              listPrice = Number(priceLamports) / 1e9;
              console.log('Found list price from Tensor data:', listPrice, 'SOL');
            } catch (error) {
              console.error('Error decoding Tensor listing data:', error);
            }
          }
        }

        // Validate the price
        if (listPrice && listPrice > 0 && listPrice < 1000000) { // Reasonable price range
          return {
            type: 'listed',
            details: {
              marketplace: marketplace,
              lister: oldOwner,
              timestamp: new Date().toISOString(),
              price: listPrice
            }
          };
        } else {
          console.log('No valid list price found in transaction');
        }
      } else {
        console.log('No listing transaction found');
      }
    }
    
    // Check if the NFT was delisted
    if ((normalizedOldOwner === '1bwutmtvypwdtmw9abtk4ssr8no61spgavw1x6ndix' || 
         normalizedOldOwner === '4zdnggatfsw1cqghqkiwyrsxaagxrsrrnnuunxzjxue') && 
        normalizedNewOwner !== '1bwutmtvypwdtmw9abtk4ssr8no61spgavw1x6ndix' &&
        normalizedNewOwner !== '4zdnggatfsw1cqghqkiwyrsxaagxrsrrnnuunxzjxue') {
      return { 
        type: 'delisted',
        details: {
          marketplace: normalizedOldOwner === '1bwutmtvypwdtmw9abtk4ssr8no61spgavw1x6ndix' ? 'Magic Eden' : 'Tensor',
          owner: newOwner, // Use new owner (not escrow)
          timestamp: new Date().toISOString()
        }
      };
    }
    
    // If neither wallet is an escrow, it's a transfer
    if (normalizedOldOwner !== normalizedNewOwner && 
        normalizedNewOwner !== '1bwutmtvypwdtmw9abtk4ssr8no61spgavw1x6ndix' &&
        normalizedNewOwner !== '4zdnggatfsw1cqghqkiwyrsxaagxrsrrnnuunxzjxue') {
      return { 
        type: 'transfer',
        details: {
          from: oldOwner,
          to: newOwner,
          timestamp: new Date().toISOString()
        }
      };
    }
    
    return { type: 'unknown' };
  } catch (error) {
    console.error('Error determining ownership change:', error);
    return { type: 'unknown' };
  }
}

// Helper to get display name from user_roles
async function getDiscordNameForWallet(client, wallet) {
  if (!wallet) return null;
  
  // First get the discord_id from user_wallets
  const { rows: walletRows } = await client.query(
    'SELECT discord_id FROM user_wallets WHERE wallet_address = $1 LIMIT 1',
    [wallet]
  );
  
  if (walletRows.length === 0) return null;
  
  const discordId = walletRows[0].discord_id;
  
  // Then get the discord_name from user_roles
  const { rows: roleRows } = await client.query(
    'SELECT discord_name FROM user_roles WHERE discord_id = $1 LIMIT 1',
    [discordId]
  );
  
  return roleRows[0]?.discord_name || null;
}

// Function to handle ownership changes
async function handleOwnershipChange(client, nft, dbNFT, change, collection) {
  console.log(`Processing ownership change for ${nft.id}:`);
  console.log(`- Change type: ${change.type}`);
  console.log(`- New owner: ${nft.ownership.owner}`);
  console.log(`- Old owner: ${dbNFT.owner_wallet}`);

  try {
    // Get Discord names for owners
    const newOwnerDiscord = await getDiscordNameForWallet(client, nft.ownership.owner);
    const oldOwnerDiscord = await getDiscordNameForWallet(client, dbNFT.owner_wallet);
    
    let listPrice = null;
    let listerDiscordName = null;
    let marketplace = null;

    // If this is a listing event, fetch transaction history to get price
    if (change.type === 'listed') {
      console.log(`\nFetching transaction history for ${nft.id} to get list price...`);
      
      const response = await fetch(
        `https://api.helius.xyz/v0/addresses/${nft.id}/transactions?api-key=${process.env.HELIUS_API_KEY}`
      );
      
      if (!response.ok) {
        console.error(`Failed to fetch transaction history: ${response.statusText}`);
        throw new Error(`Failed to fetch transaction history: ${response.statusText}`);
      }
      
      const transactions = await response.json();
      console.log(`Found ${transactions.length} transactions`);
      
      // Find the most recent listing transaction
      const listingTx = transactions.find(tx => {
        return tx.type === 'NFT_LISTING' || 
               (tx.events?.nft?.type === 'NFT_LISTING');
      });
      
      if (listingTx) {
        console.log('Found listing transaction:', listingTx);
        
        // Try to get price from events first
        if (listingTx.events?.nft) {
          const event = listingTx.events.nft;
          if (event.amount) {
            listPrice = event.amount / 1e9; // Convert lamports to SOL
            marketplace = event.source === 'MAGIC_EDEN' ? 'Magic Eden' : 
                         event.source === 'TENSOR' ? 'Tensor' : 
                         event.source || 'Unknown';
            listerDiscordName = await getDiscordNameForWallet(client, event.seller || listingTx.feePayer);
            console.log('Found list price from events:', listPrice, 'SOL');
          }
        }
        
        // If no price in events, try to get from transaction description
        if (!listPrice && listingTx.description) {
          const priceMatch = listingTx.description.match(/(\d+\.?\d*)\s*SOL/);
          if (priceMatch) {
            listPrice = parseFloat(priceMatch[1]);
            marketplace = listingTx.source || 'Unknown';
            listerDiscordName = await getDiscordNameForWallet(client, listingTx.feePayer);
            console.log('Found list price from description:', listPrice, 'SOL');
          }
        }

        // For Tensor listings, try to decode the program data
        if (!listPrice && marketplace === 'TENSOR' && listingTx.events) {
          const tensorEvent = listingTx.events.find(event => 
            event.programId === 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN'
          );
          
          if (tensorEvent && tensorEvent.data) {
            try {
              // Decode base64 data
              const decodedData = Buffer.from(tensorEvent.data, 'base64');
              // Price is in bytes 16-23
              const priceBytes = decodedData.slice(16, 24);
              const priceLamports = priceBytes.readBigUInt64LE();
              listPrice = Number(priceLamports) / 1e9;
              marketplace = 'Tensor';
              listerDiscordName = await getDiscordNameForWallet(client, listingTx.feePayer);
              console.log('Found list price from Tensor data:', listPrice, 'SOL');
            } catch (error) {
              console.error('Error decoding Tensor listing data:', error);
            }
          }
        }

        // Update database with listing information
        if (listPrice && listPrice > 0) {
          await client.query(
            `UPDATE nft_metadata 
             SET owner_wallet = $1,
                 is_listed = true,
                 list_price = $2,
                 marketplace = $3,
                 original_lister = $4,
                 lister_discord_name = $5
             WHERE mint_address = $6`,
            [
              nft.ownership.owner, // escrow wallet
              listPrice,
              marketplace,
              dbNFT.owner_wallet, // original owner
              listerDiscordName,
              nft.id
            ]
          );
        }
      }
    } else if (change.type === 'sold') {
      // Fetch transaction history to get sale price and details
      console.log(`\nFetching transaction history for ${nft.id} to get sale price...`);
      const response = await fetch(
        `https://api.helius.xyz/v0/addresses/${nft.id}/transactions?api-key=${process.env.HELIUS_API_KEY}`
      );
      if (!response.ok) {
        console.error(`Failed to fetch transaction history: ${response.statusText}`);
        throw new Error(`Failed to fetch transaction history: ${response.statusText}`);
      }
      const transactions = await response.json();
      console.log(`Found ${transactions.length} transactions`);
      // Find the most recent sale transaction
      const saleTx = transactions.find(tx => tx.type === 'NFT_SALE' || (tx.events?.nft?.type === 'NFT_SALE'));
      let salePrice = null;
      let marketplace = null;
      let buyer = null;
      let seller = null;
      if (saleTx) {
        console.log('Found sale transaction:', saleTx);
        if (saleTx.events?.nft) {
          const event = saleTx.events.nft;
          salePrice = event.amount / 1e9;
          marketplace = event.source || 'Magic Eden';
          buyer = event.buyer;
          seller = event.seller;
        } else if (saleTx.description) {
          const priceMatch = saleTx.description.match(/(\d+\.?\d*)\s*SOL/);
          if (priceMatch) {
            salePrice = parseFloat(priceMatch[1]);
          }
          marketplace = saleTx.source || 'Magic Eden';
        }
      }
      // Update DB: set owner_wallet to buyer, is_listed to false, clear list_price, marketplace, original_lister, lister_discord_name, set last_sale_price
      await client.query(
        `UPDATE nft_metadata 
         SET owner_wallet = $1,
             is_listed = false,
             list_price = NULL,
             marketplace = NULL,
             original_lister = NULL,
             lister_discord_name = NULL,
             last_sale_price = $2
         WHERE mint_address = $3`,
        [buyer || nft.ownership.owner, salePrice, nft.id]
      );
      // Fetch the latest NFT row from the database
      const { rows: [updatedNFT] } = await client.query(
        'SELECT * FROM nft_metadata WHERE mint_address = $1',
        [nft.id]
      );
      // Fetch Discord names for buyer and seller
      const buyerDiscord = await getDiscordNameForWallet(client, buyer);
      const sellerDiscord = await getDiscordNameForWallet(client, seller);
      // Prepare and send the embed
      const message = formatDiscordMessage({
        type: change.type,
        nft: {
          ...updatedNFT,
          name: updatedNFT.name,
          salePrice: salePrice,
          marketplace: marketplace,
          owner_discord_id: buyerDiscord,
          previous_owner_wallet: seller,
          previous_owner_discord: sellerDiscord
        }
      });
      await sendActivityNotification(message);
      return;
    } else if (change.type === 'delisted') {
      await client.query(
        `UPDATE nft_metadata 
        SET is_listed = false, 
            list_price = NULL, 
            lister_discord_name = NULL,
            marketplace = NULL,
            owner_wallet = $1,
            original_lister = NULL
        WHERE mint_address = $2`,
        [nft.ownership.owner, nft.id]
      );
    } else if (change.type === 'transferred' || change.type === 'transfer') {
      await client.query(
        `UPDATE nft_metadata 
        SET owner_wallet = $1,
            owner_discord_id = $2
        WHERE mint_address = $3`,
        [nft.ownership.owner, newOwnerDiscord, nft.id]
      );
    }

    // Fetch the latest NFT row from the database
    const { rows: [updatedNFT] } = await client.query(
      'SELECT * FROM nft_metadata WHERE mint_address = $1',
      [nft.id]
    );

    // Fetch Discord names for all relevant wallets
    const latestOwnerDiscord = await getDiscordNameForWallet(client, updatedNFT.owner_wallet);
    const previousOwnerDiscord = await getDiscordNameForWallet(client, dbNFT.owner_wallet);

    // Prepare the message for Discord
    let message;
    if (change.type === 'listed') {
      message = formatDiscordMessage({
        type: change.type,
        nft: {
          ...updatedNFT,
          name: updatedNFT.name,
          original_lister: dbNFT.owner_wallet,
          lister_discord_name: previousOwnerDiscord,
          listPrice: listPrice,
          marketplace: updatedNFT.marketplace,
        }
      });
    } else if (change.type === 'delisted') {
      message = formatDiscordMessage({
        type: change.type,
        nft: {
          ...updatedNFT,
          name: updatedNFT.name,
          owner_discord_id: latestOwnerDiscord,
        }
      });
    } else if (change.type === 'transferred' || change.type === 'transfer') {
      message = formatDiscordMessage({
        type: change.type,
        nft: {
          ...updatedNFT,
          name: updatedNFT.name,
          previous_owner_wallet: dbNFT.owner_wallet,
          previous_owner_discord: previousOwnerDiscord,
          owner_discord_id: latestOwnerDiscord,
        }
      });
    } else if (change.type === 'sold') {
      message = formatDiscordMessage({
        type: change.type,
        nft: {
          ...updatedNFT,
          name: updatedNFT.name,
          salePrice: salePrice,
          marketplace: marketplace,
          owner_discord_id: latestOwnerDiscord,
        }
      });
    } else {
      message = formatDiscordMessage({
        type: change.type,
        nft: {
          ...updatedNFT,
          name: updatedNFT.name,
        }
      });
    }
    await sendActivityNotification(message);

  } catch (error) {
    console.error('Error handling ownership change:', error);
  }
}

// Add the event-specific embed formatter here:
function formatDiscordMessage(data) {
  const { type, nft } = data;

  const getCollectionLogo = (symbol) => {
    const logos = {
      'FCKEDCATZ': '/logos/cat.PNG',
      'CelebCatz': '/logos/celeb.PNG',
      'MM': '/logos/monster.PNG',
      'MM3D': '/logos/monster.PNG',
      'AIBB': '/collab-images/ai-apes.jpg',
      'AELxAIBB': '/collab-images/ai-apes.jpg',
      'AIRB': '/collab-images/rejected-bots.jpg',
      'AUSQRL': '/collab-images/ai-squirrels.jpg',
      'DDBOT': '/collab-images/doodlebots.jpg',
      'CLB': '/collab-images/candybots.jpg'
    };
    return `https://buxdao.com${logos[symbol] || '/logos/default.PNG'}`;
  };

  const getDisplayName = (wallet, discordName) => {
    if (!wallet) return 'Unknown';
    return discordName || `\`${wallet.slice(0, 4)}...${wallet.slice(-4)}\``;
  };

  const getMarketplaceLinks = (mint) =>
    `[View on Magic Eden](https://magiceden.io/item-details/${mint}) • [View on Tensor](https://www.tensor.trade/item/${mint})`;

  const getImageUrl = (imageUrl) => {
    if (!imageUrl) return null;
    
    // If it's a local PNG path (starts with /)
    if (imageUrl.startsWith('/')) {
      return `https://buxdao.com${imageUrl}`;
    }
    
    // If it's already a full URL
    if (imageUrl.startsWith('http')) {
      return imageUrl;
    }
    
    // If it's a relative path without leading slash
    return `https://buxdao.com/${imageUrl}`;
  };

  const fields = [];
  let title = '';
  let description = '';
  let color = 0x000000;

  switch (type) {
    case 'listed':
      title = `📝 LISTED - ${nft.name || nft.name || 'Unknown NFT'}`;
      color = 0x4CAF50;
      fields.push(
        { name: ' Price', value: `${Number(data.listPrice ?? nft.list_price ?? 0).toFixed(2)} SOL`, inline: false },
        { name: ' Owner', value: getDisplayName(nft.original_lister, nft.lister_discord_name), inline: false },
        { name: ' Marketplace', value: data.marketplace || nft.marketplace || 'Unknown', inline: false }
      );
      if (nft.rarity_rank) {
        fields.push({ name: '✨ Rank', value: `#${nft.rarity_rank}`, inline: false });
      }
      break;
    case 'sold':
      title = `💰 SOLD - ${nft.name || 'Unknown NFT'}`;
      color = 0xF44336;
      fields.push(
        { name: '💰 Price', value: `${Number(data.salePrice ?? nft.last_sale_price ?? 0).toFixed(2)} SOL`, inline: false },
        { name: '👤 New Owner', value: getDisplayName(nft.owner_wallet, nft.owner_discord_id), inline: false },
        { name: '🏪 Marketplace', value: data.marketplace || nft.marketplace || 'Unknown', inline: false }
      );
      if (nft.rarity_rank) {
        fields.push({ name: '✨ Rank', value: `#${nft.rarity_rank}`, inline: false });
      }
      break;
    case 'delisted':
      title = `❌ DELISTED - ${nft.name || 'Unknown NFT'}`;
      color = 0xFF9800;
      fields.push(
        { name: '👤 Owner', value: getDisplayName(nft.owner_wallet, nft.owner_discord_id), inline: false }
      );
      if (nft.rarity_rank) {
        fields.push({ name: '✨ Rank', value: `#${nft.rarity_rank}`, inline: false });
      }
      break;
    case 'transfer':
      title = `♻️ TRANSFER - ${nft.name || 'Unknown NFT'}`;
      color = 0x2196F3;
      fields.push(
        { name: '👤 From', value: getDisplayName(nft.previous_owner_wallet, nft.previous_owner_discord), inline: false },
        { name: '👤 To', value: getDisplayName(nft.owner_wallet, nft.owner_discord_id), inline: false }
      );
      if (nft.rarity_rank) {
        fields.push({ name: '✨ Rank', value: `#${nft.rarity_rank}`, inline: false });
      }
      break;
    case 'burned':
      title = `🔥 BURNED - ${nft.name || 'Unknown NFT'}`;
      color = 0x9E9E9E;
      if (nft.rarity_rank) {
        fields.push({ name: '✨ Rank', value: `#${nft.rarity_rank}`, inline: false });
      }
      break;
    default:
      throw new Error(`Unknown event type for embed: ${type}`);
  }

  description = getMarketplaceLinks(nft.mint_address);

  const embed = {
    title: title,
    description: description,
    color: color,
    fields: fields,
    thumbnail: {
      url: getCollectionLogo(nft.symbol)
    },
    footer: {
      text: 'BUXDAO • Putting Community First'
    },
    timestamp: new Date().toISOString()
  };

  embed.image = { url: getImageUrl(nft.image_url) };

  if (!title) {
    throw new Error(`Unknown event type for embed: ${type}`);
  }

  return { embeds: [embed] };
}

// Main sync function for a single collection
async function syncCollection(pool, collection) {
  console.log(`\n=== Starting ${collection.name} NFT ownership sync ===`);
  
  if (TEST_MODE) {
    console.log('\n=== RUNNING IN TEST MODE - NO DATABASE CHANGES WILL BE MADE ===\n');
  }

  const client = await pool.connect();
  
  // Add summary tracking object
  const summary = {
    nftsFound: 0,
    nftsInDB: 0,
    newNFTs: 0,
    ownershipChanges: {
      transfers: 0,
      sales: 0,
      listings: 0,
      delists: 0,
      burns: 0
    }
  };
  
  try {
    // Fetch all NFTs in the collection
    console.log(`Fetching NFTs for ${collection.name}...`);
    const collectionNFTs = await fetchCollectionNFTs(collection);
    console.log(`Found ${collectionNFTs.length} NFTs in ${collection.name}`);
    
    if (collectionNFTs.length === 0) {
      console.log(`No NFTs found for ${collection.name} - exiting`);
      return;
    }
    
    // Update summary with NFTs found
    summary.nftsFound = collectionNFTs.length;
    
    // Get current database state for this collection
    console.log(`Fetching database state for ${collection.name}...`);
    const { rows: dbNFTs } = await client.query(
      `SELECT 
        mint_address, 
        name,
        symbol,
        owner_wallet,
        original_lister,
        is_listed,
        marketplace,
        list_price,
        last_sale_price,
        rarity_rank,
        image_url,
        owner_discord_id,
        owner_name,
        lister_discord_name
      FROM nft_metadata 
      WHERE symbol = $1`,
      [collection.name]
    );
    
    // Update summary with DB counts
    summary.nftsInDB = dbNFTs.length;
    
    console.log(`\nDatabase state for ${collection.name}:`);
    console.log(`- Total NFTs in database: ${dbNFTs.length}`);
    console.log(`- Total NFTs in collection: ${collectionNFTs.length}`);
    console.log(`- NFTs in DB but not in collection: ${dbNFTs.filter(dbNFT => !collectionNFTs.find(nft => nft.id === dbNFT.mint_address)).length}`);
    console.log(`- NFTs in collection but not in DB: ${collectionNFTs.filter(nft => !dbNFTs.find(dbNFT => dbNFT.mint_address === nft.id)).length}`);
    console.log(`- NFTs with potential ownership changes: ${collectionNFTs.filter(nft => {
      const dbNFT = dbNFTs.find(dbNFT => dbNFT.mint_address === nft.id);
      return dbNFT && dbNFT.owner_wallet !== nft.ownership.owner;
    }).length}`);
    
    // Create maps for quick lookup
    const dbNFTMap = new Map(dbNFTs.map(nft => [nft.mint_address, nft]));
    const collectionNFTMap = new Map(collectionNFTs.map(nft => [nft.id, nft]));
    
    // Process each NFT in the collection
    for (const nft of collectionNFTs) {
      const dbNFT = dbNFTMap.get(nft.id);
      
      if (!dbNFT) {
        summary.newNFTs++;
        if (TEST_MODE) {
          console.log(`\nTest Mode: New NFT Found:`, {
            mint: nft.id,
            name: nft.content.metadata.name,
            owner: nft.ownership.owner,
            collection: collection.name
          });
        } else {
          // Check current OG420 count to determine if this new NFT should be OG420
          const og420CountResult = await client.query(
            `SELECT COUNT(*) as count FROM nft_metadata WHERE symbol = $1 AND og420 = TRUE`,
            [collection.name]
          );
          const currentOg420Count = parseInt(og420CountResult.rows[0]?.count || 0);
          const isOg420 = currentOg420Count < 420;
          
          if (isOg420) {
            console.log(`Marking new NFT ${nft.id} as OG420 (current count: ${currentOg420Count}/420)`);
          } else {
            console.log(`New NFT ${nft.id} will NOT be OG420 (already at 420 limit)`);
          }
          
          // New NFT - insert into database
          await client.query(
            `INSERT INTO nft_metadata (
              mint_address, 
              name, 
              symbol, 
              owner_wallet, 
              image_url, 
              rarity_rank,
              is_listed,
              marketplace,
              list_price,
              last_sale_price,
              owner_discord_id,
              owner_name,
              lister_discord_name,
              og420
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              nft.id,
              nft.content.metadata.name,
              collection.name,
              nft.ownership.owner,
              nft.content.links.image,
              null,
              false,
              null,
              null,
              null,
              null,
              null,
              null,
              isOg420
            ]
          );
        }
        continue;
      }
      
      // Check for ownership changes
      if (dbNFT.owner_wallet !== nft.ownership.owner) {
        const isNewOwnerEscrow = ESCROW_WALLETS.has(nft.ownership.owner);
        // Listing: NFT was not listed, now in escrow
        if (!dbNFT.is_listed && isNewOwnerEscrow) {
          summary.ownershipChanges.listings++;
          if (TEST_MODE) {
            console.log(`\nTest Mode: Forced Listing Detected:`, {
              mint: nft.id,
              name: nft.content.metadata.name,
              previous_owner: dbNFT.owner_wallet,
              new_owner: nft.ownership.owner
            });
          } else {
            await handleOwnershipChange(client, nft, dbNFT, {
              type: 'listed',
              details: {
                marketplace: getMarketplaceName(nft.ownership.owner),
                lister: dbNFT.owner_wallet,
                timestamp: new Date().toISOString()
              }
            }, collection);
          }
        } else if (dbNFT.is_listed && !isNewOwnerEscrow) {
          if (nft.ownership.owner === dbNFT.original_lister) {
            // Delist event
            summary.ownershipChanges.delists++;
            if (TEST_MODE) {
              console.log(`\nTest Mode: Forced Delist Detected:`, {
                mint: nft.id,
                name: nft.content.metadata.name,
                previous_owner: dbNFT.owner_wallet,
                new_owner: nft.ownership.owner
              });
            } else {
              await handleOwnershipChange(client, nft, dbNFT, {
                type: 'delisted',
                details: {
                  marketplace: dbNFT.marketplace,
                  owner: nft.ownership.owner,
                  timestamp: new Date().toISOString()
                }
              }, collection);
            }
          } else {
            // Sale event
            summary.ownershipChanges.sales++;
            if (TEST_MODE) {
              console.log(`\nTest Mode: Forced Sale Detected:`, {
                mint: nft.id,
                name: nft.content.metadata.name,
                previous_owner: dbNFT.owner_wallet,
                new_owner: nft.ownership.owner
              });
            } else {
              await handleOwnershipChange(client, nft, dbNFT, {
                type: 'sold',
                details: {
                  marketplace: dbNFT.marketplace,
                  seller: dbNFT.original_lister,
                  buyer: nft.ownership.owner,
                  timestamp: new Date().toISOString()
                }
              }, collection);
            }
          }
        } else {
          const change = await determineOwnershipChange(
            nft.id,
            dbNFT.owner_wallet,
            nft.ownership.owner
          );
          // Update summary with ownership changes
          summary.ownershipChanges[change.type]++;
          if (TEST_MODE) {
            console.log(`\nTest Mode: Ownership Change Detected:`, {
              mint: nft.id,
              name: nft.content.metadata.name,
              type: change.type,
              previous_owner: dbNFT.owner_wallet,
              new_owner: nft.ownership.owner,
              details: change.details
            });
          } else {
            await handleOwnershipChange(client, nft, dbNFT, change, collection);
          }
        }
      } else if (TEST_MODE) {
        console.log(`\nTest Mode: No Change for NFT:`, {
          mint: nft.id,
          name: nft.content.metadata.name,
          owner: nft.ownership.owner,
          collection: collection.name
        });
      }
    }
    
    // Check for NFTs in DB but not in collection
    for (const dbNFT of dbNFTs) {
      if (!collectionNFTMap.has(dbNFT.mint_address)) {
        if (TEST_MODE) {
          console.log(`\nTest Mode: NFT Not Found in Collection:`, {
            mint: dbNFT.mint_address,
            name: dbNFT.name,
            last_known_owner: dbNFT.owner_wallet,
            collection: collection.name
          });
        } else {
          // Handle missing NFT case
          try {
            const nftStatus = await fetch(`https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'my-id',
                method: 'getAsset',
                params: { id: dbNFT.mint_address }
              })
            }).then(res => res.json());

            if (nftStatus.result?.burnt === true) {
              summary.ownershipChanges.burns++;
              
              await sendActivityNotification({
                type: 'burned',
                nft: {
                  mint_address: dbNFT.mint_address,
                  name: dbNFT.name,
                  symbol: dbNFT.symbol,
                  owner_wallet: dbNFT.owner_wallet,
                  original_lister: dbNFT.original_lister,
                  rarity_rank: dbNFT.rarity_rank,
                  image_url: dbNFT.image_url
                }
              });
              
              await client.query(
                `DELETE FROM nft_metadata WHERE mint_address = $1`,
                [dbNFT.mint_address]
              );
            }
          } catch (error) {
            console.error(`Error checking NFT status for ${dbNFT.mint_address}:`, error);
          }
        }
      }
    }
    
    // Display summary
    console.log('\n=== SYNC SUMMARY ===');
    console.log(`Collection: ${collection.name}`);
    console.log(`Total NFTs Found: ${summary.nftsFound}`);
    console.log(`Total NFTs in Database: ${summary.nftsInDB}`);
    console.log(`New NFTs Found: ${summary.newNFTs}`);
    console.log('\nOwnership Changes:');
    console.log(`- Transfers: ${summary.ownershipChanges.transfers}`);
    console.log(`- Sales: ${summary.ownershipChanges.sales}`);
    console.log(`- Listings: ${summary.ownershipChanges.listings}`);
    console.log(`- Delists: ${summary.ownershipChanges.delists}`);
    console.log(`- Burns: ${summary.ownershipChanges.burns}`);
    
    console.log(`\n=== ${collection.name} NFT ownership sync completed successfully ===`);
    if (TEST_MODE) {
      console.log('\n=== TEST MODE COMPLETED - NO CHANGES WERE MADE ===');
    }
  } catch (error) {
    console.error(`Error during ${collection.name} NFT ownership sync:`, error);
    throw error;
  } finally {
    client.release();
  }
}

// Function to sync Discord roles for all users
async function syncAllUserRoles(pool) {
  const client = await pool.connect();
  try {
    console.log('Fetching all users with Discord IDs...');
    const result = await client.query(
      'SELECT discord_id FROM user_roles WHERE discord_id IS NOT NULL'
    );
    
    const totalUsers = result.rows.length;
    console.log(`Found ${totalUsers} users to sync roles for`);
    
    if (totalUsers === 0) {
      console.log('No users found, skipping role sync');
      return;
    }
    
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      console.error('DISCORD_GUILD_ID not set, skipping role sync');
      return;
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < result.rows.length; i++) {
      const { discord_id } = result.rows[i];
      try {
        const success = await syncUserRoles(discord_id, guildId);
        if (success) {
          successCount++;
        } else {
          failCount++;
          console.error(`Failed to sync roles for user ${discord_id}`);
        }
        
        // Log progress every 10 users
        if ((i + 1) % 10 === 0) {
          console.log(`Role sync progress: ${i + 1}/${totalUsers} users processed (${successCount} success, ${failCount} failed)`);
        }
        
        // Add delay between users to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        failCount++;
        console.error(`Error syncing roles for user ${discord_id}:`, error.message);
      }
    }
    
    console.log(`\nRole sync summary: ${successCount} successful, ${failCount} failed out of ${totalUsers} total users`);
  } catch (error) {
    console.error('Error in syncAllUserRoles:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Main function to sync all collections
export default async function syncAllCollections() {
  if (TEST_MODE) {
    console.log('\n=== RUNNING IN TEST MODE - NO DATABASE CHANGES WILL BE MADE ===\n');
  }

  // Verify Helius API key is set
  if (!process.env.HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY environment variable is required');
  }

  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  
  try {
    console.log('\n=== Starting Generic NFT Collections Sync ===');
    console.log(`Processing ${collections.length} collections...`);
    console.log(`Using Helius API for NFT fetching`);
    
    for (const collection of collections) {
      await syncCollection(pool, collection);
      // Add delay between collections to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n=== All collections sync completed successfully ===');
    
    // Sync Discord roles for all users after collection sync
    if (!TEST_MODE) {
      console.log('\n=== Starting Discord role sync for all users ===');
      try {
        await syncAllUserRoles(pool);
        console.log('=== Discord role sync completed ===');
      } catch (error) {
        console.error('Error during Discord role sync:', error);
        // Don't throw - allow collection sync to be considered successful
      }
    }
    
    if (TEST_MODE) {
      console.log('\n=== TEST MODE COMPLETED - NO CHANGES WERE MADE ===');
    }
  } catch (error) {
    console.error('Error during collections sync:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the sync if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncAllCollections()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
} 