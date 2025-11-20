import axios from 'axios';
import dbPool from '../../config/database.js';
import { getRuntimeConfig } from '../../../config/runtime.js';

// Discord interaction types
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5
};

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9
};

const MAGIC_EDEN_API_BASE = 'https://api-mainnet.magiceden.io/v2';
const MAGIC_EDEN_SYMBOL = 'cannasolz'; // Magic Eden API uses lowercase
const DB_COLLECTION_SYMBOL = 'CNSZ'; // Database uses uppercase symbol

// Convert lamports to SOL
function lamportsToSol(lamports) {
  return (lamports / 1_000_000_000).toFixed(2);
}

// Format large numbers
function formatNumber(num) {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + 'K';
  }
  return num.toString();
}

// Fetch collection data from Magic Eden
async function fetchCollectionData() {
  try {
    const response = await axios.get(`${MAGIC_EDEN_API_BASE}/collections/${MAGIC_EDEN_SYMBOL}`, {
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching Magic Eden data:', error);
    throw error;
  }
}

// Get total NFT count from database
async function getTotalCollectionCount() {
  let client;
  try {
    client = await dbPool.connect();
    const result = await client.query(
      'SELECT COUNT(*) as total FROM nft_metadata WHERE symbol = $1',
      [DB_COLLECTION_SYMBOL]
    );
    return parseInt(result.rows[0]?.total || 0, 10);
  } catch (error) {
    console.error('Error fetching total collection count:', error);
    return null;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Get Discord user avatar URL
function getUserAvatarUrl(user) {
  if (!user) return null;
  
  const userId = user.id;
  const avatar = user.avatar;
  const discriminator = user.discriminator;
  
  if (avatar) {
    // User has custom avatar
    return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=256`;
  } else if (discriminator) {
    // Default avatar based on discriminator
    return `https://cdn.discordapp.com/embed/avatars/${parseInt(discriminator) % 5}.png`;
  } else {
    // New username system (no discriminator) - use default avatar
    return `https://cdn.discordapp.com/embed/avatars/0.png`;
  }
}

// Handle /mynfts command
export async function handleMyNFTsCommand(interaction) {
  let client;
  try {
    // Get user from interaction (guild or DM)
    const user = interaction.member?.user || interaction.user;
    if (!user) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Unable to identify user.',
          flags: 64 // Ephemeral
        }
      };
    }
    
    const discordId = user.id;
    const username = user.global_name || user.username || 'Unknown User';
    const avatarUrl = getUserAvatarUrl(user);
    
    // Query collection_counts for this user
    client = await dbPool.connect();
    const result = await client.query(
      `SELECT 
        COALESCE(gold_count, 0) as gold_count,
        COALESCE(silver_count, 0) as silver_count,
        COALESCE(purple_count, 0) as purple_count,
        COALESCE(dark_green_count, 0) as dark_green_count,
        COALESCE(light_green_count, 0) as light_green_count,
        COALESCE(og420_count, 0) as og420_count,
        COALESCE(total_count, 0) as total_count,
        COALESCE(cnft_gold_count, 0) as cnft_gold_count,
        COALESCE(cnft_silver_count, 0) as cnft_silver_count,
        COALESCE(cnft_purple_count, 0) as cnft_purple_count,
        COALESCE(cnft_dark_green_count, 0) as cnft_dark_green_count,
        COALESCE(cnft_light_green_count, 0) as cnft_light_green_count,
        COALESCE(cnft_total_count, 0) as cnft_total_count
      FROM collection_counts 
      WHERE discord_id = $1`,
      [discordId]
    );
    
    const row = result.rows[0];
    
    if (!row || row.total_count === 0) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: `📦 NFT Holdings - ${username}`,
            description: 'No NFTs found in your collection.',
            color: 0xFFA500,
            thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
            footer: {
              text: 'CannaSolz',
              icon_url: 'https://cannasolz.vercel.app/favicon.jpeg'
            },
            timestamp: new Date().toISOString()
          }],
          flags: 64 // Ephemeral
        }
      };
    }
    
    // Build fields for NFT counts
    const fields = [];
    
    // Regular NFTs (left column)
    if (row.gold_count > 0) {
      fields.push({ name: '🟡 Gold', value: row.gold_count.toString(), inline: true });
    }
    if (row.silver_count > 0) {
      fields.push({ name: '⚪ Silver', value: row.silver_count.toString(), inline: true });
    }
    if (row.purple_count > 0) {
      fields.push({ name: '🟣 Purple', value: row.purple_count.toString(), inline: true });
    }
    if (row.dark_green_count > 0) {
      fields.push({ name: '🟢 Dark Green', value: row.dark_green_count.toString(), inline: true });
    }
    if (row.light_green_count > 0) {
      fields.push({ name: '💚 Light Green', value: row.light_green_count.toString(), inline: true });
    }
    if (row.og420_count > 0) {
      fields.push({ name: '🌿 OG420', value: row.og420_count.toString(), inline: true });
    }
    
    // cNFTs (right column)
    if (row.cnft_gold_count > 0) {
      fields.push({ name: '🟡 cNFT Gold', value: row.cnft_gold_count.toString(), inline: true });
    }
    if (row.cnft_silver_count > 0) {
      fields.push({ name: '⚪ cNFT Silver', value: row.cnft_silver_count.toString(), inline: true });
    }
    if (row.cnft_purple_count > 0) {
      fields.push({ name: '🟣 cNFT Purple', value: row.cnft_purple_count.toString(), inline: true });
    }
    if (row.cnft_dark_green_count > 0) {
      fields.push({ name: '🟢 cNFT Dark Green', value: row.cnft_dark_green_count.toString(), inline: true });
    }
    if (row.cnft_light_green_count > 0) {
      fields.push({ name: '💚 cNFT Light Green', value: row.cnft_light_green_count.toString(), inline: true });
    }
    
    // Total at the bottom
    const totalNFTs = row.total_count;
    const totalCNFTs = row.cnft_total_count;
    const grandTotal = totalNFTs + totalCNFTs;
    
    if (grandTotal > 0) {
      fields.push({
        name: '📊 Total',
        value: `Regular: ${totalNFTs}\nCompressed: ${totalCNFTs}\n**Grand Total: ${grandTotal}**`,
        inline: false
      });
    }
    
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [{
          title: `📦 NFT Holdings - ${username}`,
          color: 0x95D5B2, // Green color matching brand
          thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
          fields: fields.length > 0 ? fields : [{ name: 'Total', value: grandTotal.toString(), inline: false }],
          footer: {
            text: 'CannaSolz',
            icon_url: 'https://cannasolz.vercel.app/favicon.jpeg'
          },
          timestamp: new Date().toISOString()
        }],
        flags: 64 // Ephemeral
      }
    };
  } catch (error) {
    console.error('Error handling mynfts command:', error);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ Failed to fetch NFT holdings. Please try again later.',
        flags: 64 // Ephemeral
      }
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Handle /collection command
export async function handleCollectionCommand() {
  try {
    // Fetch Magic Eden data and total count in parallel
    const [data, totalCount] = await Promise.all([
      fetchCollectionData(),
      getTotalCollectionCount()
    ]);
    
    const floorPrice = lamportsToSol(data.floorPrice || 0);
    const listedCount = data.listedCount || 0;
    const totalVolume = lamportsToSol(data.volumeAll || 0);
    
    // Format listed count as "listed/total" or just "listed" if total not available
    const listedCountDisplay = totalCount !== null 
      ? `${listedCount.toLocaleString()}/${totalCount.toLocaleString()}`
      : `${listedCount.toLocaleString()}`;
    
    // Get base URL for favicon from runtime config
    const runtime = getRuntimeConfig();
    const baseUrl = runtime.frontendUrl || 'https://cannasolz.vercel.app';
    const faviconUrl = `${baseUrl}/favicon.jpeg`;
    
    const embed = {
      title: `📊 ${data.name || 'CannaSolz'} Collection Stats`,
      description: data.description || 'CannaSolz NFT Collection',
      color: 0x95D5B2, // Green color matching brand
      thumbnail: {
        url: faviconUrl
      },
      fields: [
        {
          name: '💰 Floor Price',
          value: `${floorPrice} SOL`,
          inline: true
        },
        {
          name: '📋 Listed',
          value: listedCountDisplay,
          inline: true
        },
        {
          name: '📈 Total Volume',
          value: `${totalVolume} SOL`,
          inline: true
        }
      ],
      footer: {
        text: 'Data from Magic Eden',
        icon_url: 'https://magiceden.io/favicon.ico'
      },
      timestamp: new Date().toISOString(),
      url: `https://magiceden.io/marketplace/${MAGIC_EDEN_SYMBOL}`
    };
    
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [embed]
      }
    };
  } catch (error) {
    console.error('Error handling collection command:', error);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ Failed to fetch collection data. Please try again later.',
        flags: 64 // Ephemeral
      }
    };
  }
}

// Main command handler
export async function handleCommand(interaction) {
  const commandName = interaction.data?.name;
  
  switch (commandName) {
    case 'collection':
      return await handleCollectionCommand();
    case 'mynfts':
      return await handleMyNFTsCommand(interaction);
    default:
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `Unknown command: ${commandName}`,
          flags: 64 // Ephemeral
        }
      };
  }
}

