import expressPkg from 'express';
import dbPool from '../config/database.js';
import { parse } from 'cookie';

const userBalanceRouter = expressPkg.Router();

// GET /api/user/balance - sum token balance from token_holders for current user
userBalanceRouter.get('/', async (req, res) => {
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
    const { rows } = await dbPool.query(
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

export default userBalanceRouter; 