import axios from 'axios';
import dbPool from '../config/database.js';
import { getRuntimeConfig } from '../config/runtime.js';

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
const COLLECTION_SYMBOL = 'cannasolz';

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
    const response = await axios.get(`${MAGIC_EDEN_API_BASE}/collections/${COLLECTION_SYMBOL}`, {
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
      [COLLECTION_SYMBOL]
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
      url: `https://magiceden.io/marketplace/${COLLECTION_SYMBOL}`
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

