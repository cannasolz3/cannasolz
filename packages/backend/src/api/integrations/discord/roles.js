import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dbPool from '../../config/database.js';

// Cache roles data
let rolesCache = null;
let rolesCacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

let discordClient = null;

// Function to get or initialize Discord client
async function getDiscordClient() {
  if (!discordClient) {
    try {
      const botToken = process.env.DISCORD_BOT_TOKEN;
      if (!botToken) {
        console.error('DISCORD_BOT_TOKEN environment variable is not set');
        return null;
      }
      
      console.log('Initializing Discord client...', {
        hasToken: !!botToken,
        tokenLength: botToken?.length,
        tokenPrefix: botToken?.substring(0, 10) + '...'
      });
      
      discordClient = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.GuildPresences,
          GatewayIntentBits.GuildMessages
        ],
        partials: [
          Partials.User,
          Partials.GuildMember,
          Partials.Message
        ]
      });

      // Set up event handlers
      discordClient.on('ready', () => {
        console.log(`Discord client ready! Logged in as ${discordClient.user.tag}`);
      });

      discordClient.on('error', (error) => {
        console.error('Discord client error:', error);
        console.error('Error details:', {
          message: error.message,
          code: error.code,
          stack: error.stack
        });
        discordClient = null;
      });

      // Login and wait for ready event
      console.log('Attempting Discord bot login...');
      
      // Set up ready promise before login
      const readyPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Discord client ready timeout after 15 seconds'));
        }, 15000);
        
        discordClient.once('ready', () => {
          clearTimeout(timeout);
          console.log('Discord client ready event received');
          resolve();
        });
        
        discordClient.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      
      // Start login
      await discordClient.login(botToken);
      console.log('Discord login call completed, waiting for ready event...');
      
      // Wait for ready event
      await readyPromise;
      console.log('Discord client fully ready and authenticated');
    } catch (error) {
      console.error('Failed to initialize Discord client:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        name: error.name,
        stack: error.stack
      });
      discordClient = null;
      return null;
    }
  }
  return discordClient;
}

// Function to get roles from database
async function getRoles() {
  // Check cache first
  const now = Date.now();
  if (rolesCache && rolesCacheTimestamp && (now - rolesCacheTimestamp < CACHE_DURATION)) {
    return rolesCache;
  }

  const client = await dbPool.connect();
  try {
    const result = await client.query('SELECT * FROM roles ORDER BY type, collection');
    rolesCache = result.rows;
    rolesCacheTimestamp = now;
    return result.rows;
  } finally {
    client.release();
  }
}

// Function to sync user roles
export async function syncUserRoles(discordId, guildId) {
  console.log(`Syncing roles for user ${discordId} in guild ${guildId}`);
  
  const client = await dbPool.connect();
  try {
    // Get user's role flags from user_roles
    const userResult = await client.query(
      `SELECT * FROM user_roles WHERE discord_id = $1`,
      [discordId]
    );

    if (userResult.rowCount === 0) {
      console.log(`No user_roles entry found for Discord ID: ${discordId}`);
      return false;
    }

    const userRoles = userResult.rows[0];
    console.log('User roles from database:', userRoles);
    
    const roles = await getRoles();
    console.log('Available roles:', roles);
    
    // Get Discord client
    const discord = await getDiscordClient();
    if (!discord) {
      console.error('Discord client unavailable - skipping role sync');
      return false;
    }
    
    // Ensure client is ready
    if (!discord.isReady()) {
      console.log('Discord client not ready, waiting...');
      await new Promise((resolve) => {
        if (discord.isReady()) {
          resolve();
        } else {
          discord.once('ready', resolve);
          // Timeout after 5 seconds
          setTimeout(() => {
            console.error('Discord client ready timeout');
            resolve();
          }, 5000);
        }
      });
    }
    
    if (!discord.isReady()) {
      console.error('Discord client still not ready after wait');
      return false;
    }
    
    console.log('Discord client ready, proceeding with role sync');
    
    // Get Discord guild and member
    try {
      console.log('Fetching guild...');
      const guild = await discord.guilds.fetch(guildId);
      console.log('Guild fetched:', guild.name);
      
      console.log('Fetching member...');
      const member = await guild.members.fetch(discordId);
      console.log('Member fetched:', member.user.tag);
      
      if (!member) {
        console.log(`Member ${discordId} not found in guild ${guildId}`);
        return false;
      }

      // Track role changes
      const rolesToAdd = [];
      const rolesToRemove = [];

      // Get the list of role IDs we manage from the roles table
      const managedRoleIds = roles.map(r => r.discord_role_id);

      // Check each role
      for (const role of roles) {
        const shouldHaveRole = checkRoleEligibility(userRoles, role);
        const hasRole = member.roles.cache.has(role.discord_role_id);
        console.log(`Role ${role.name}: Should have - ${shouldHaveRole}, Has role - ${hasRole}`);

        if (shouldHaveRole && !hasRole) {
          rolesToAdd.push(role.discord_role_id);
        } else if (!shouldHaveRole && hasRole) {
          // Only remove roles that we manage
          if (managedRoleIds.includes(role.discord_role_id)) {
            rolesToRemove.push(role.discord_role_id);
          }
        }
      }

      console.log('Roles to add:', rolesToAdd);
      console.log('Roles to remove:', rolesToRemove);

      // Apply role changes
      if (rolesToAdd.length > 0) {
        try {
          console.log(`Attempting to add ${rolesToAdd.length} roles to member ${discordId}...`);
          await member.roles.add(rolesToAdd);
          console.log(`Successfully added roles for ${discordId}:`, rolesToAdd);
        } catch (error) {
          console.error('Error adding roles:', error);
          console.error('Error details:', {
            message: error.message,
            code: error.code,
            status: error.status,
            rolesToAdd,
            memberId: discordId,
            guildId: guildId
          });
          throw error; // Re-throw so caller knows it failed
        }
      } else {
        console.log(`No roles to add for ${discordId}`);
      }

      if (rolesToRemove.length > 0) {
        try {
          await member.roles.remove(rolesToRemove);
          console.log(`Removed roles for ${discordId}:`, rolesToRemove);
        } catch (error) {
          console.error('Error removing roles:', error);
        }
      }

      return true;
    } catch (error) {
      console.error('Discord API error:', error);
      return false;
    }
  } catch (error) {
    console.error('Error syncing user roles:', error);
    return false;
  } finally {
    client.release();
  }
}

// Helper function to check if user should have a role
function checkRoleEligibility(userRoles, role) {
  // Check if user has this role in their roles JSONB array
  if (userRoles.roles && Array.isArray(userRoles.roles)) {
    // Convert both to strings for comparison (discord_role_id might be numeric or string)
    const roleIdStr = String(role.discord_role_id);
    const hasRole = userRoles.roles.some(r => {
      const rIdStr = String(r.id || '');
      return rIdStr === roleIdStr || 
        (r.name === role.name && r.collection === role.collection);
    });
    console.log(`Checking eligibility for ${role.name} (${role.discord_role_id}): ${hasRole}`, {
      userRolesArray: userRoles.roles.map(r => ({ id: r.id, name: r.name, collection: r.collection })),
      checkingRole: { id: role.discord_role_id, name: role.name, collection: role.collection }
    });
    return hasRole;
  }
  
  console.log(`No roles array found for user, checking eligibility for ${role.name}: false`);
  return false;
} 