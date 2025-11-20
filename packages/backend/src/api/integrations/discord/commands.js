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

// Handle /mycsz420 command
export async function handleMyCSz420Command(interaction) {
  let client;
  try {
    // Get command issuer
    const issuer = interaction.member?.user || interaction.user;
    if (!issuer) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Unable to identify user.',
          flags: 0 // Public
        }
      };
    }
    
    // Check if user option is provided and if issuer has permission
    const userOption = interaction.data?.options?.find(opt => opt.type === 6); // USER type
    const isAdminOrOwner = hasAdminOrOwnerRole(interaction);
    
    // Determine target user
    let targetUser;
    if (userOption && isAdminOrOwner) {
      // Admin/Owner viewing another user
      const targetUserId = userOption.value;
      if (targetUserId && interaction.data?.resolved?.users?.[targetUserId]) {
        targetUser = interaction.data.resolved.users[targetUserId];
      } else if (targetUserId) {
        // Fallback: create minimal user object with just ID
        targetUser = { id: targetUserId };
      } else {
        targetUser = null;
      }
    } else if (userOption && !isAdminOrOwner) {
      // Non-admin trying to view another user - deny
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ You do not have permission to view other users\' token data.',
          flags: 0 // Public
        }
      };
    } else {
      // Viewing own data
      targetUser = issuer;
    }
    
    if (!targetUser) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Invalid user specified.',
          flags: 0 // Public
        }
      };
    }
    
    const discordId = targetUser.id;
    const username = targetUser.global_name || targetUser.username || 'Unknown User';
    const avatarUrl = getUserAvatarUrl(targetUser);
    
    // Query token data: daily yield, unclaimed balance, and actual token balance
    client = await dbPool.connect();
    
    // First get daily yield and unclaimed balance
    const result = await client.query(
      `SELECT 
        COALESCE(dr.total_daily_reward, 0) as daily_yield,
        COALESCE(ca.unclaimed_amount, 0) as unclaimed_balance
      FROM (SELECT $1::text as discord_id) AS u
      LEFT JOIN daily_rewards dr ON dr.discord_id = u.discord_id
      LEFT JOIN claim_accounts ca ON ca.discord_id = u.discord_id`,
      [discordId]
    );
    
    const row = result.rows[0] || { daily_yield: 0, unclaimed_balance: 0 };
    
    // Get actual token balance - first try by owner_discord_id
    let balanceResult = await client.query(
      `SELECT COALESCE(SUM(balance), 0) AS balance
       FROM token_holders
       WHERE owner_discord_id = $1`,
      [discordId]
    );
    
    let actualBalance = Number(balanceResult.rows[0]?.balance || 0);
    
    // Fallback: if no balance found by owner_discord_id, check wallets from user_wallets
    if (actualBalance === 0) {
      const walletRows = await client.query(
        `SELECT wallet_address FROM user_wallets WHERE discord_id = $1`,
        [discordId]
      );
      
      if (walletRows.rows.length > 0) {
        const walletAddresses = walletRows.rows.map(r => r.wallet_address);
        const balanceRows = await client.query(
          `SELECT COALESCE(SUM(balance), 0) AS balance
           FROM token_holders
           WHERE wallet_address = ANY($1::text[])`,
          [walletAddresses]
        );
        actualBalance = Number(balanceRows.rows[0]?.balance || 0);
      }
    }
    
    row.actual_balance = actualBalance;
    
    if (!row) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          embeds: [{
            title: `💰 CSz420 Token - ${username}`,
            description: 'No token data found.',
            color: 0xFFA500,
            thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
            footer: {
              text: 'CannaSolz',
              icon_url: 'https://cannasolz.vercel.app/favicon.jpeg'
            },
            timestamp: new Date().toISOString()
          }],
          flags: 0 // Public
        }
      };
    }
    
    // Format numbers with commas
    const formatTokenAmount = (amount) => {
      const num = Number(amount);
      if (num === 0) return '0';
      return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
    };
    
    const dailyYield = formatTokenAmount(row.daily_yield);
    const unclaimedBalance = formatTokenAmount(row.unclaimed_balance);
    const actualBalance = formatTokenAmount(row.actual_balance);
    
    const fields = [
      {
        name: 'Daily Yield',
        value: `${dailyYield} $CSz420`,
        inline: true
      },
      {
        name: 'Unclaimed',
        value: `${unclaimedBalance} $CSz420`,
        inline: true
      },
      {
        name: 'Balance',
        value: `${actualBalance} $CSz420`,
        inline: true
      }
    ];
    
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [{
          title: `💰 CSz420 Token - ${username}`,
          color: 0x95D5B2, // Green color matching brand
          thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
          fields: fields,
          footer: {
            text: 'CannaSolz',
            icon_url: 'https://cannasolz.vercel.app/favicon.jpeg'
          },
          timestamp: new Date().toISOString()
        }],
        flags: 0 // Public
      }
    };
  } catch (error) {
    console.error('Error handling mycsz420 command:', error);
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ Failed to fetch token data. Please try again later.',
        flags: 64 // Ephemeral
      }
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Check if user has admin or owner role
function hasAdminOrOwnerRole(interaction) {
  // Roles are only available in guild interactions (not DMs)
  if (!interaction.member?.roles) return false;
  
  const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
  const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID;
  
  if (!ADMIN_ROLE_ID && !OWNER_ROLE_ID) return false;
  
  // Discord passes roles as an array of role IDs
  const memberRoles = Array.isArray(interaction.member.roles) 
    ? interaction.member.roles 
    : [];
  
  return (ADMIN_ROLE_ID && memberRoles.includes(ADMIN_ROLE_ID)) ||
         (OWNER_ROLE_ID && memberRoles.includes(OWNER_ROLE_ID));
}

// Handle /mynfts command
export async function handleMyNFTsCommand(interaction) {
  let client;
  try {
    // Get command issuer
    const issuer = interaction.member?.user || interaction.user;
    if (!issuer) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Unable to identify user.',
          flags: 0 // Public
        }
      };
    }
    
    // Check if user option is provided and if issuer has permission
    const userOption = interaction.data?.options?.find(opt => opt.type === 6); // USER type
    const isAdminOrOwner = hasAdminOrOwnerRole(interaction);
    
    // Determine target user
    let targetUser;
    if (userOption && isAdminOrOwner) {
      // Admin/Owner viewing another user
      const targetUserId = userOption.value;
      if (targetUserId && interaction.data?.resolved?.users?.[targetUserId]) {
        targetUser = interaction.data.resolved.users[targetUserId];
      } else if (targetUserId) {
        // Fallback: create minimal user object with just ID
        targetUser = { id: targetUserId };
      } else {
        targetUser = null;
      }
    } else if (userOption && !isAdminOrOwner) {
      // Non-admin trying to view another user - deny
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ You do not have permission to view other users\' NFT holdings.',
          flags: 0 // Public
        }
      };
    } else {
      // Viewing own data
      targetUser = issuer;
    }
    
    if (!targetUser) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Invalid user specified.',
          flags: 0 // Public
        }
      };
    }
    
    const discordId = targetUser.id;
    const username = targetUser.global_name || targetUser.username || 'Unknown User';
    const avatarUrl = getUserAvatarUrl(targetUser);
    
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
          flags: 0 // Public
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
        flags: 0 // Public
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
        embeds: [embed],
        flags: 0 // Public
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

// Handle /help command
export async function handleHelpCommand() {
  const runtime = getRuntimeConfig();
  const baseUrl = runtime.frontendUrl || 'https://cannasolz.vercel.app';
  const faviconUrl = `${baseUrl}/favicon.jpeg`;
  
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [{
        title: 'CannaSolz Bot Commands',
        description: 'Here are all available commands:',
        color: 0x95D5B2,
        thumbnail: {
          url: faviconUrl
        },
        fields: [
          {
            name: '📊 /collection',
            value: 'Display CannaSolz collection statistics from Magic Eden',
            inline: false
          },
          {
            name: '📦 /mynfts',
            value: 'View your CannaSolz NFT holdings',
            inline: false
          },
          {
            name: '💰 /mycsz420',
            value: 'View your CSz420 token balance, daily yield, and unclaimed rewards',
            inline: false
          }
        ],
        footer: {
          text: 'CannaSolz',
          icon_url: faviconUrl
        },
        timestamp: new Date().toISOString()
      }],
      flags: 0 // Public
    }
  };
}

// Handle /pay command (Admin/Owner only)
export async function handlePayCommand(interaction) {
  let client;
  try {
    // Check if user has admin or owner role
    const isAdminOrOwner = hasAdminOrOwnerRole(interaction);
    if (!isAdminOrOwner) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ You do not have permission to use this command.',
          flags: 0 // Public
        }
      };
    }
    
    // Get user and amount options
    const userOption = interaction.data?.options?.find(opt => opt.name === 'user');
    const amountOption = interaction.data?.options?.find(opt => opt.name === 'amount');
    
    if (!userOption || !amountOption) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Missing required options: user and amount',
          flags: 0 // Public
        }
      };
    }
    
    const targetUserId = userOption.value;
    const amount = parseFloat(amountOption.value);
    
    if (!targetUserId || !amount || amount <= 0 || isNaN(amount)) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Invalid amount. Must be a positive number.',
          flags: 0 // Public
        }
      };
    }
    
    // Get target user from resolved users
    const targetUser = interaction.data?.resolved?.users?.[targetUserId];
    if (!targetUser) {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Invalid user specified.',
          flags: 0 // Public
        }
      };
    }
    
    const username = targetUser.global_name || targetUser.username || 'Unknown User';
    const avatarUrl = getUserAvatarUrl(targetUser);
    
    // Convert amount to the smallest unit (assuming 9 decimals like SOL)
    const amountInSmallestUnit = BigInt(Math.floor(amount * 1_000_000_000));
    
    // Update claim_accounts
    client = await dbPool.connect();
    await client.query('BEGIN');
    
    // Ensure claim_accounts row exists
    await client.query(
      `INSERT INTO claim_accounts (discord_id, discord_name, unclaimed_amount, total_claimed, last_claim_time, created_at)
       VALUES ($1, $2, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (discord_id) DO NOTHING`,
      [targetUserId, username]
    );
    
    // Update unclaimed_amount
    const updateResult = await client.query(
      `UPDATE claim_accounts 
       SET unclaimed_amount = unclaimed_amount + $1,
           discord_name = COALESCE(discord_name, $2)
       WHERE discord_id = $3
       RETURNING unclaimed_amount`,
      [amountInSmallestUnit.toString(), username, targetUserId]
    );
    
    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Failed to update user account.',
          flags: 0 // Public
        }
      };
    }
    
    await client.query('COMMIT');
    
    const newBalance = Number(updateResult.rows[0].unclaimed_amount) / 1_000_000_000;
    
    // Format numbers
    const formatTokenAmount = (amt) => {
      const num = Number(amt);
      if (num === 0) return '0';
      return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
    };
    
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [{
          title: '💰 Payment Processed',
          color: 0x95D5B2,
          thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
          fields: [
            {
              name: 'User Credited',
              value: `${formatTokenAmount(amount)} $CSz420`,
              inline: false
            },
            {
              name: 'New Balance',
              value: `${formatTokenAmount(newBalance)} $CSz420`,
              inline: false
            }
          ],
          footer: {
            text: 'CannaSolz',
            icon_url: 'https://cannasolz.vercel.app/favicon.jpeg'
          },
          timestamp: new Date().toISOString()
        }],
        flags: 0 // Public (so admin can see the result)
      }
    };
  } catch (error) {
    console.error('Error handling pay command:', error);
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {
        // Ignore
      }
    }
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ Failed to process payment. Please try again later.',
        flags: 64 // Ephemeral
      }
    };
  } finally {
    if (client) {
      client.release();
    }
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
    case 'mycsz420':
      return await handleMyCSz420Command(interaction);
    case 'help':
      return await handleHelpCommand();
    case 'pay':
      return await handlePayCommand(interaction);
    default:
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `Unknown command: ${commandName}`,
          flags: 0 // Public
        }
      };
  }
}

