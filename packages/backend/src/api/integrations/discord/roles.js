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
      console.log('Initializing Discord client...');
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
        console.log(`Logged in as ${discordClient.user.tag}`);
      });

      discordClient.on('error', (error) => {
        console.error('Discord client error:', error);
        discordClient = null;
      });

      // Login
      await discordClient.login(process.env.DISCORD_BOT_TOKEN);
      console.log('Discord client login successful');
    } catch (error) {
      console.error('Failed to initialize Discord client:', error);
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
          await member.roles.add(rolesToAdd);
          console.log(`Added roles for ${discordId}:`, rolesToAdd);
        } catch (error) {
          console.error('Error adding roles:', error);
        }
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
    const hasRole = userRoles.roles.some(r => 
      r.id === role.discord_role_id || 
      (r.name === role.name && r.collection === role.collection)
    );
    console.log(`Checking eligibility for ${role.name} (${role.discord_role_id}): ${hasRole}`);
    return hasRole;
  }
  
  console.log(`No roles array found for user, checking eligibility for ${role.name}: false`);
  return false;
} 