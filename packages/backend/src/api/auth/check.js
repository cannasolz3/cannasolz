import expressPkg from 'express';
import { parse } from 'cookie';
import { pool } from '../config/database.js';

const router = expressPkg.Router();

router.get('/', async (req, res) => {
  let client;
  let retries = 3;
  
  while (retries > 0) {
    try {
      console.log('Auth check request:', {
        sessionID: req.sessionID,
        hasSession: !!req.session,
        cookies: req.headers.cookie,
        retries
      });

      // Check for discord_user cookie
      const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
      const discordUser = cookies.discord_user ? JSON.parse(cookies.discord_user) : null;

      if (!discordUser || !discordUser.discord_id) {
        return res.status(401).json({
          authenticated: false,
          message: 'Not authenticated'
        });
      }

      // Get wallet addresses from user_wallets table with retries
      let dbRetries = 3;
      while (dbRetries > 0) {
        try {
          client = await pool.connect();
          const result = await client.query(
            'SELECT wallet_address FROM user_wallets WHERE discord_id = $1',
            [discordUser.discord_id]
          );

          const walletAddresses = result.rows.map(row => row.wallet_address);

          return res.json({
            authenticated: true,
            user: {
              discord_id: discordUser.discord_id,
              discord_username: discordUser.discord_username,
              avatar: discordUser.avatar,
              wallet_addresses: walletAddresses
            }
          });
        } catch (dbError) {
          console.error('Database error during auth check:', {
            error: dbError.message,
            code: dbError.code,
            retries: dbRetries - 1
          });
          
          dbRetries--;
          if (dbRetries === 0) throw dbError;
          await new Promise(resolve => setTimeout(resolve, 1000));
        } finally {
          if (client) {
            client.release();
            client = null;
          }
        }
      }
    } catch (error) {
      console.error('Auth check error:', {
        error: error.message,
        stack: error.stack,
        retries: retries - 1
      });
      
      retries--;
      if (retries === 0) {
        return res.status(500).json({
          authenticated: false,
          message: 'Internal server error',
          error: error.message
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
});

export default router; 