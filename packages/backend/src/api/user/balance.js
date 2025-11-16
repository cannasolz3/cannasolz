import expressPkg from 'express';
import { pool } from '../config/database.js';
import { parse } from 'cookie';

const router = expressPkg.Router();

// GET /api/user/balance - sum token balance from token_holders for current user
router.get('/', async (req, res) => {
  try {
    // Hydrate session from cookie if needed
    if (!req.session?.user) {
      const cookies = parse(req.headers.cookie || '');
      if (cookies.discord_user) {
        try {
          const user = JSON.parse(cookies.discord_user);
          req.session = req.session || {};
          req.session.user = {
            discord_id: user.id || user.discord_id
          };
        } catch {
          // ignore
        }
      }
    }
    if (!req.session?.user?.discord_id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(balance),0) AS balance
       FROM token_holders
       WHERE owner_discord_id = $1`,
      [req.session.user.discord_id]
    );
    return res.json({ balance: Number(rows[0]?.balance || 0) });
  } catch (error) {
    console.error('Error fetching user balance:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 
import express from 'express';
import { pool } from '../config/database.js';

const router = express.Router();

router.get('/', async (req, res) => {
  if (!req.session?.user?.discord_id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  let client;
  try {
    client = await pool.connect();

    // Get user's aggregated BUX balance and unclaimed rewards across all wallets
    const query = `
      SELECT 
        COALESCE(SUM(bh.balance), 0) as balance,
        ca.unclaimed_amount
      FROM claim_accounts ca
      LEFT JOIN token_holders bh ON bh.owner_discord_id = ca.discord_id
      WHERE ca.discord_id = $1
      GROUP BY ca.discord_id, ca.unclaimed_amount
    `;

    console.log('Executing query with discord_id:', req.session.user.discord_id);
    const result = await client.query(query, [req.session.user.discord_id]);
    console.log('Query result:', result.rows[0]);
    
    if (!result.rows[0]) {
      console.log('No results found for user');
      return res.json({
        balance: 0,
        unclaimed_amount: 0
      });
    }

    const response = {
      balance: parseInt(result.rows[0].balance) || 0,
      unclaimed_amount: parseInt(result.rows[0].unclaimed_amount) || 0
    };
    console.log('Sending response:', response);

    res.json(response);
  } catch (error) {
    console.error('Error fetching user balance:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

export default router; 