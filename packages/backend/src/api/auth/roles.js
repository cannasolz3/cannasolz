import dbPool from '../config/database.js';
import { parse } from 'cookie';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = parse(req.headers.cookie || '');
  const discordUser = cookies.discord_user ? JSON.parse(cookies.discord_user) : null;

  if (!discordUser?.discord_id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  let client;
  try {
    client = await dbPool.connect();
    console.log('Fetching roles for discord_id:', discordUser.discord_id);

    // Load full user role flags
    const userResult = await client.query(
      'SELECT * FROM user_roles WHERE discord_id = $1',
      [discordUser.discord_id]
    );

    if (userResult.rowCount === 0) {
      console.log('No roles found for user in user_roles, checking collection_counts as fallback');
      const counts = await client.query(
        'SELECT total_count FROM collection_counts WHERE discord_id = $1',
        [discordUser.discord_id]
      );
      if (Number(counts.rows[0]?.total_count || 0) > 0) {
        return res.json({ roles: [{ id: 'holder-local', name: 'Holder', type: 'holder', color: '#22c55e', collection: 'cannasolz', display_name: 'CannaSolz Holder' }] });
      }
      return res.json({ roles: [] });
    }

    const userRoles = userResult.rows[0];

    // Load role catalog
    const rolesCatalogResult = await client.query('SELECT * FROM roles ORDER BY type, collection');
    const rolesCatalog = rolesCatalogResult.rows || [];

    // Helper to check eligibility based on flags/thresholds
    const isEligible = (role) => {
      switch (role.type) {
        case 'holder': {
          switch (role.collection) {
            case 'fcked_catz':
              return !!userRoles.fcked_catz_holder;
            case 'money_monsters':
              return !!userRoles.money_monsters_holder || !!userRoles.money_monsters_top_10;
            case 'ai_bitbots':
              return !!userRoles.ai_bitbots_holder;
            case 'moneymonsters3d':
              return !!userRoles.moneymonsters3d_holder || !!userRoles.money_monsters_3d_top_10;
            case 'celebcatz':
              return !!userRoles.celebcatz_holder;
            case 'shxbb':
              return !!userRoles.shxbb_holder;
            case 'ausqrl':
              return !!userRoles.ausqrl_holder;
            case 'aelxaibb':
              return !!userRoles.aelxaibb_holder;
            case 'airb':
              return !!userRoles.airb_holder;
            case 'clb':
              return !!userRoles.clb_holder;
            case 'ddbot':
              return !!userRoles.ddbot_holder;
            case 'seedling_gold':
              return !!userRoles.harvester_gold;
            case 'seedling_silver':
              return !!userRoles.harvester_silver;
            case 'seedling_purple':
              return !!userRoles.harvester_purple;
            case 'seedling_dark_green':
              return !!userRoles.harvester_dark_green;
            case 'seedling_light_green':
              return !!userRoles.harvester_light_green;
            default:
              return false;
          }
        }
        case 'collab': {
          // Collab roles are holder-style flags for partner collections
          switch (role.collection) {
            case 'shxbb':
              return !!userRoles.shxbb_holder;
            case 'ausqrl':
              return !!userRoles.ausqrl_holder;
            case 'aelxaibb':
              return !!userRoles.aelxaibb_holder;
            case 'airb':
              return !!userRoles.airb_holder;
            case 'clb':
              return !!userRoles.clb_holder;
            case 'ddbot':
              return !!userRoles.ddbot_holder;
            default:
              return false;
          }
        }
        case 'whale': {
          switch (role.collection) {
            case 'fcked_catz':
              return !!userRoles.fcked_catz_whale;
            case 'money_monsters':
              return !!userRoles.money_monsters_whale;
            case 'ai_bitbots':
              return !!userRoles.ai_bitbots_whale;
            case 'moneymonsters3d':
              return !!userRoles.moneymonsters3d_whale;
            default:
              return false;
          }
        }
        case 'token': {
          if (role.collection === 'bux') {
            switch (role.name) {
              case 'BUX Beginner':
                return !!userRoles.bux_beginner;
              case 'BUX Builder':
                return !!userRoles.bux_builder;
              case 'BUX Saver':
                return !!userRoles.bux_saver;
              case 'BUX Banker':
                return !!userRoles.bux_banker;
              default:
                return false;
            }
          }
          return false;
        }
        case 'special': {
          // BUXDAO 5 etc.
          return role.name === 'BUXDAO 5' ? !!userRoles.buxdao_5 : false;
        }
        default:
          return false;
      }
    };

    // Build response roles from catalog
    const eligibleRoles = rolesCatalog
      .filter(isEligible)
      .map(role => ({
        id: String(role.discord_role_id),
        name: role.name,
        type: role.type,
        color: role.color,
        emoji_url: role.emoji_url,
        collection: role.collection,
        display_name: role.display_name
      }));

    // If no eligibleRoles computed, fall back to stored JSON if present
    if (!eligibleRoles.length && Array.isArray(userRoles.roles)) {
      const flatStored = Array.isArray(userRoles.roles[0]) ? userRoles.roles[0] : userRoles.roles;
      return res.json({ roles: flatStored });
    }

    if (eligibleRoles.length) {
      return res.json({ roles: eligibleRoles });
    }
    // Final fallback: holder if counts > 0
    const counts = await client.query(
      'SELECT total_count FROM collection_counts WHERE discord_id = $1',
      [discordUser.discord_id]
    );
    if (Number(counts.rows[0]?.total_count || 0) > 0) {
      return res.json({ roles: [{ id: 'holder-local', name: 'Holder', type: 'holder', color: '#22c55e', collection: 'cannasolz', display_name: 'CannaSolz Holder' }] });
    }
    return res.json({ roles: [] });

  } catch (error) {
    console.error('Error fetching user roles:', error);
    if (error.position) {
      console.error('Error position:', error.position);
    }
    if (error.detail) {
      console.error('Error detail:', error.detail);
    }
    if (error.hint) {
      console.error('Error hint:', error.hint);
    }
    res.status(500).json({ error: 'Internal server error', details: error.message });
  } finally {
    if (client) {
      client.release();
    }
  }
} 