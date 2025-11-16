import expressPkg from 'express';
import { pool } from '../config/database.js';
import { parse } from 'cookie';

const router = expressPkg.Router();

// GET /api/user/wallets - returns all wallets linked to the current Discord user
router.get('/', async (req, res) => {
  // Fallback auth: hydrate session from cookie in serverless
  if (!req.session?.user) {
    const cookies = parse(req.headers.cookie || '');
    if (cookies.discord_user) {
      try {
        const user = JSON.parse(cookies.discord_user);
        req.session = req.session || {};
        req.session.user = {
          discord_id: user.id || user.discord_id,
          discord_username: user.username || user.discord_username,
          discord_display_name: user.discord_display_name || user.global_name || user.display_name || user.username,
          avatar: user.avatar || null
        };
      } catch {
        // ignore parse errors
      }
    }
  }
  if (!req.session?.user?.discord_id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const result = await pool.query(
      'SELECT wallet_address FROM user_wallets WHERE discord_id = $1',
      [req.session.user.discord_id]
    );
    const wallets = result.rows.map(row => row.wallet_address);
    res.json({ wallets });
  } catch (error) {
    console.error('Error fetching user wallets:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/user/wallets - add a new wallet for the current Discord user
router.post('/', async (req, res) => {
  // Fallback auth: hydrate session from cookie in serverless
  if (!req.session?.user) {
    const cookies = parse(req.headers.cookie || '');
    if (cookies.discord_user) {
      try {
        const user = JSON.parse(cookies.discord_user);
        req.session = req.session || {};
        req.session.user = {
          discord_id: user.id || user.discord_id,
          discord_username: user.username || user.discord_username,
          discord_display_name: user.discord_display_name || user.global_name || user.display_name || user.username,
          avatar: user.avatar || null
        };
      } catch {
        // ignore parse errors
      }
    }
  }
  if (!req.session?.user?.discord_id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { wallet_address } = req.body;
  if (!wallet_address) {
    return res.status(400).json({ error: 'Missing wallet_address' });
  }
  try {
    const discordId = req.session.user.discord_id;
    const discordName = req.session.user.discord_username || req.session.user.discord_name || null;

    // Insert wallet if not already present
    await pool.query(
      `INSERT INTO user_wallets (discord_id, wallet_address, discord_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (discord_id, wallet_address) DO UPDATE SET discord_name = EXCLUDED.discord_name`,
      [discordId, wallet_address, discordName]
    );

    // Sync ownership in nft_metadata for this wallet
    await pool.query(
      `
        UPDATE nft_metadata
        SET owner_discord_id = $1,
            owner_name = $2
        WHERE owner_wallet = $3
      `,
      [discordId, discordName, wallet_address]
    );

    // Upsert collection_counts per-colour and totals for this user
    await pool.query(
      `
        INSERT INTO collection_counts (
          discord_id, discord_name,
          gold_count, silver_count, purple_count, dark_green_count, light_green_count,
          total_count, last_updated
        )
        SELECT
          $1::varchar AS discord_id,
          $2::varchar AS discord_name,
          COUNT(*) FILTER (WHERE nm.leaf_colour = 'Gold')        AS gold_count,
          COUNT(*) FILTER (WHERE nm.leaf_colour = 'Silver')      AS silver_count,
          COUNT(*) FILTER (WHERE nm.leaf_colour = 'Purple')      AS purple_count,
          COUNT(*) FILTER (WHERE nm.leaf_colour = 'Dark green')  AS dark_green_count,
          COUNT(*) FILTER (WHERE nm.leaf_colour = 'Light green') AS light_green_count,
          COUNT(*) AS total_count,
          NOW() AS last_updated
        FROM nft_metadata nm
        WHERE nm.owner_discord_id = $1::varchar
        ON CONFLICT (discord_id) DO UPDATE SET
          discord_name = EXCLUDED.discord_name,
          gold_count = EXCLUDED.gold_count,
          silver_count = EXCLUDED.silver_count,
          purple_count = EXCLUDED.purple_count,
          dark_green_count = EXCLUDED.dark_green_count,
          light_green_count = EXCLUDED.light_green_count,
          total_count = EXCLUDED.total_count,
          last_updated = NOW()
      `,
      [discordId, discordName]
    );

    // Ensure counts are recomputed (in case triggers are not present)
    await pool.query('SELECT update_collection_counts($1::varchar)', [discordId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Error adding user wallet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 