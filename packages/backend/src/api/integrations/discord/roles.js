import { Client, GatewayIntentBits, Partials } from 'discord.js';
import dbPool from '../../config/database.js';
import fetch from 'node-fetch';

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
      
      // Check if already ready (race condition protection)
      if (discordClient.isReady()) {
        console.log('Discord client already ready');
        return discordClient;
      }
      
      // Set up ready promise before login
      let readyResolve, readyReject;
      const readyPromise = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      
      const timeout = setTimeout(() => {
        console.error('Discord client ready timeout after 10 seconds');
        readyReject(new Error('Discord client ready timeout after 10 seconds'));
      }, 10000);
      
      const readyHandler = () => {
        clearTimeout(timeout);
        console.log('Discord client ready event received');
        readyResolve();
      };
      
      const errorHandler = (error) => {
        clearTimeout(timeout);
        console.error('Discord client error during initialization:', error);
        readyReject(error);
      };
      
      // Set up listeners BEFORE login
      discordClient.once('ready', readyHandler);
      discordClient.once('error', errorHandler);
      
      try {
        // Start login
        await discordClient.login(botToken);
        console.log('Discord login call completed, waiting for ready event...');
        
        // Wait for ready event
        await readyPromise;
        console.log('Discord client fully ready and authenticated');
      } catch (loginError) {
        // Clean up listeners if login fails
        discordClient.removeListener('ready', readyHandler);
        discordClient.removeListener('error', errorHandler);
        clearTimeout(timeout);
        throw loginError;
      }
      
      // Clean up one-time listeners (they should have fired, but just in case)
      discordClient.removeListener('ready', readyHandler);
      discordClient.removeListener('error', errorHandler);
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
      console.error('Discord client unavailable - attempting REST API fallback');
      // Fallback to REST API if client fails
      return await syncUserRolesViaRestAPI(discordId, guildId, userRoles, roles);
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
          console.error('Error adding roles via Discord.js:', error);
          console.error('Error details:', {
            message: error.message,
            code: error.code,
            status: error.status,
            rolesToAdd,
            memberId: discordId,
            guildId: guildId
          });
          
          // Fallback: Try REST API directly
          console.log('Attempting fallback to Discord REST API...');
          try {
            await addRolesViaRestAPI(guildId, discordId, rolesToAdd);
            console.log(`Successfully added roles via REST API for ${discordId}:`, rolesToAdd);
          } catch (restError) {
            console.error('REST API fallback also failed:', restError);
            throw restError;
          }
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

// Full sync function using REST API (fallback when Discord.js client fails)
async function syncUserRolesViaRestAPI(discordId, guildId, userRoles, roles) {
  console.log(`Syncing roles via REST API for user ${discordId} in guild ${guildId}`);
  
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error('DISCORD_BOT_TOKEN not set');
    return false;
  }
  
  try {
    // Get current member from Discord
    const memberResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, {
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!memberResponse.ok) {
      if (memberResponse.status === 404) {
        console.log(`Member ${discordId} not found in guild ${guildId}`);
        return false;
      }
      const errorText = await memberResponse.text();
      throw new Error(`Failed to fetch member: ${memberResponse.status} ${errorText}`);
    }
    
    const member = await memberResponse.json();
    const currentRoles = member.roles || [];
    console.log('Current member roles:', currentRoles);
    
    // Determine which roles to add/remove
    const rolesToAdd = [];
    const rolesToRemove = [];
    const managedRoleIds = roles.map(r => r.discord_role_id);
    
    for (const role of roles) {
      const shouldHaveRole = checkRoleEligibility(userRoles, role);
      // Ensure role ID is a string for comparison
      const roleIdStr = String(role.discord_role_id);
      const hasRole = currentRoles.some(r => String(r) === roleIdStr);
      console.log(`Role ${role.name} (${roleIdStr}): Should have - ${shouldHaveRole}, Has role - ${hasRole}`, {
        currentRolesSample: currentRoles.slice(0, 3),
        roleIdStr,
        roleIdType: typeof role.discord_role_id
      });
      
      if (shouldHaveRole && !hasRole) {
        rolesToAdd.push(roleIdStr);
        console.log(`Adding role ${role.name} (${roleIdStr}) to rolesToAdd`);
      } else if (!shouldHaveRole && hasRole && managedRoleIds.includes(role.discord_role_id)) {
        rolesToRemove.push(roleIdStr);
        console.log(`Removing role ${role.name} (${roleIdStr}) from user`);
      }
    }
    
    console.log('Roles to add:', rolesToAdd);
    console.log('Roles to remove:', rolesToRemove);
    
    if (rolesToAdd.length === 0 && rolesToRemove.length === 0) {
      console.log('No role changes needed');
      return true;
    }
    
    // Calculate final roles list
    let finalRoles = [...currentRoles];
    
    // Add new roles
    for (const roleId of rolesToAdd) {
      if (!finalRoles.includes(roleId)) {
        finalRoles.push(roleId);
      }
    }
    
    // Remove roles
    finalRoles = finalRoles.filter(roleId => !rolesToRemove.includes(roleId));
    
    // Update member roles
    console.log(`Updating Discord member ${discordId} with ${finalRoles.length} total roles (adding ${rolesToAdd.length}, removing ${rolesToRemove.length})`);
    console.log(`Roles being added:`, rolesToAdd);
    console.log(`Final roles list (first 5):`, finalRoles.slice(0, 5));
    
    const updateResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        roles: finalRoles
      })
    });
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`Discord API error response:`, {
        status: updateResponse.status,
        statusText: updateResponse.statusText,
        errorText,
        rolesBeingAdded: rolesToAdd,
        finalRolesCount: finalRoles.length
      });
      throw new Error(`Failed to update roles: ${updateResponse.status} ${errorText}`);
    }
    
    const updatedMember = await updateResponse.json().catch(() => null);
    console.log(`Successfully synced roles via REST API for user ${discordId}`, {
      rolesAdded: rolesToAdd.length,
      rolesRemoved: rolesToRemove.length,
      totalRoles: updatedMember?.roles?.length || finalRoles.length
    });
    return true;
  } catch (error) {
    console.error('Error syncing roles via REST API:', error);
    return false;
  }
}

// Fallback function to add roles via REST API
async function addRolesViaRestAPI(guildId, userId, roleIds) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    throw new Error('DISCORD_BOT_TOKEN not set');
  }
  
  // Get current member roles
  const memberResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!memberResponse.ok) {
    const errorText = await memberResponse.text();
    throw new Error(`Failed to fetch member: ${memberResponse.status} ${errorText}`);
  }
  
  const member = await memberResponse.json();
  const currentRoles = member.roles || [];
  
  // Merge new roles with existing ones
  const allRoles = [...new Set([...currentRoles, ...roleIds])];
  
  // Update member roles
  const updateResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      roles: allRoles
    })
  });
  
  if (!updateResponse.ok) {
    const errorText = await updateResponse.text();
    throw new Error(`Failed to update roles: ${updateResponse.status} ${errorText}`);
  }
  
  console.log(`Successfully updated roles via REST API for user ${userId}`);
}

// Helper function to check if user should have a role
function checkRoleEligibility(userRoles, role) {
  // Check if user has this role in their roles JSONB array
  if (userRoles.roles && Array.isArray(userRoles.roles)) {
    // Convert both to strings for comparison (discord_role_id might be numeric or string)
    const roleIdStr = String(role.discord_role_id);
    const hasRole = userRoles.roles.some(r => {
      const rIdStr = String(r.id || '');
      const idMatch = rIdStr === roleIdStr;
      const nameMatch = r.name === role.name && r.collection === role.collection;
      if (idMatch || nameMatch) {
        console.log(`Role match found for ${role.name}:`, { idMatch, nameMatch, rIdStr, roleIdStr, rName: r.name, roleName: role.name });
      }
      return idMatch || nameMatch;
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