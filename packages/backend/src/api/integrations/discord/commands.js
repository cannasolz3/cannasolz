import axios from 'axios';

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

// Handle /collection command
export async function handleCollectionCommand() {
  try {
    const data = await fetchCollectionData();
    
    const floorPrice = lamportsToSol(data.floorPrice || 0);
    const listedCount = data.listedCount || 0;
    const totalVolume = lamportsToSol(data.volumeAll || 0);
    
    const embed = {
      title: `📊 ${data.name || 'CannaSolz'} Collection Stats`,
      description: data.description || 'CannaSolz NFT Collection',
      color: 0x95D5B2, // Green color matching brand
      thumbnail: {
        url: data.image || 'https://creator-hub-prod.s3.us-east-2.amazonaws.com/cannasolz_pfp_1668579712636.png'
      },
      fields: [
        {
          name: '💰 Floor Price',
          value: `${floorPrice} SOL`,
          inline: true
        },
        {
          name: '📋 Total Listed',
          value: `${listedCount.toLocaleString()}`,
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

