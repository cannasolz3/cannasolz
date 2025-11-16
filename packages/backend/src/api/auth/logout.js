import expressPkg from 'express';
import dbPool from '../config/database.js';
import { getRuntimeConfig } from '../../config/runtime.js';

const router = expressPkg.Router();
const runtime = getRuntimeConfig();
const FRONTEND_URL = runtime.frontendUrl;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'connect.sid';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: runtime.cookies.secure,
  sameSite: runtime.cookies.secure ? 'none' : 'lax',
  path: '/',
  domain: runtime.cookies.domain,
  expires: new Date(0)
};

router.post('/', async (req, res) => {
  console.log('Logout request received:', {
    sessionID: req.sessionID,
    cookies: req.cookies,
    headers: req.headers
  });

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, Pragma');

  try {
    const cookiesToClear = [
      'discord_user',
      'discord_token',
      'discord_state',
      'auth_status',
      SESSION_COOKIE_NAME
    ];

    cookiesToClear.forEach((cookieName) => {
      res.clearCookie(cookieName, COOKIE_OPTIONS);
      res.clearCookie(cookieName, { ...COOKIE_OPTIONS, domain: undefined });
    });

    let client;
    try {
      client = await dbPool.connect();
      await client.query('DELETE FROM "session" WHERE sid = $1', [req.sessionID]);
    } catch (dbError) {
      console.error('Database error during logout:', dbError);
    } finally {
      if (client) {
        client.release();
      }
    }

    if (req.session) {
      await new Promise((resolve) => {
        req.session.destroy((err) => {
          if (err) {
            console.error('Session destruction error:', err);
          }
          resolve();
        });
      });
    }

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0'
    });

    console.log('Logout successful:', {
      sessionID: req.sessionID,
      clearedCookies: cookiesToClear
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

router.options('/', (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, Pragma');
  res.status(200).end();
});

export default router;
