import fetch from 'node-fetch';
import dbPool from '../../../api/config/database.js';

// Production URLs
const FRONTEND_URL = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://buxdao.com' : 'http://localhost:5173');
const API_URL = process.env.API_URL || (process.env.NODE_ENV === 'production' ? 'https://api.buxdao.com' : 'http://localhost:3001');
const CALLBACK_URL = `${API_URL}/api/auth/discord/callback`;

// Cookie settings
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true, // Always use secure cookies
  sameSite: 'lax',
  path: '/',
  domain: process.env.NODE_ENV === 'production' ? '.buxdao.com' : 'localhost',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  
  try {
    console.log('Discord callback received:', { 
      code: req.query.code ? 'present' : 'missing',
      state: req.query.state ? 'present' : 'missing',
      headers: req.headers,
      cookies: req.headers.cookie,
      env: process.env.NODE_ENV,
      callbackUrl: CALLBACK_URL
    });

    const { code, state } = req.query;

    if (!code) {
      console.error('No code provided in Discord callback');
      return res.redirect(`${FRONTEND_URL}/verify?error=no_code`);
    }

    // Exchange code for token
    console.log('Attempting token exchange with:', {
      clientId: process.env.DISCORD_CLIENT_ID ? 'present' : 'missing',
      clientSecret: process.env.DISCORD_CLIENT_SECRET ? 'present' : 'missing',
      callbackUrl: CALLBACK_URL
    });

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: CALLBACK_URL
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorText,
        headers: tokenResponse.headers
      });
      return res.redirect(`${FRONTEND_URL}/verify?error=token_exchange_failed&details=${encodeURIComponent(errorText)}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful');

    // Get user data
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });

    if (!userResponse.ok) {
      console.error('User data fetch failed:', await userResponse.text());
      return res.redirect(`${FRONTEND_URL}/verify?error=user_data_failed`);
    }

    const userData = await userResponse.json();
    console.log('User data fetched successfully:', { id: userData.id, username: userData.username });

    // Get database connection
    client = await dbPool.connect();

    // Update user record
    await client.query(
      `INSERT INTO user_roles (discord_id, discord_name) 
       VALUES ($1, $2)
       ON CONFLICT (discord_id) 
       DO UPDATE SET 
         discord_name = $2,
         last_updated = CURRENT_TIMESTAMP`,
      [userData.id, userData.username]
    );

    console.log('Database record updated');

    // Set user info
    const userInfo = {
      discord_id: userData.id,
      discord_username: userData.username,
      avatar: userData.avatar
    };

    // Set session data
    if (req.session) {
      req.session.user = userInfo;
      req.session.token = tokenData.access_token;
      await new Promise((resolve, reject) => {
        req.session.save(err => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);

    // Set cookies as backup
    res.cookie('discord_user', JSON.stringify(userInfo), COOKIE_OPTIONS);
    res.cookie('discord_token', tokenData.access_token, COOKIE_OPTIONS);

    console.log('Session and cookies set, redirecting to verify page');

    // Release client before redirect
    if (client) {
      client.release();
      client = null;
    }

    return res.redirect(`${FRONTEND_URL}/verify`);

  } catch (error) {
    console.error('Discord callback error:', error);

    if (client) {
      client.release();
      client = null;
    }

    // Clear session and cookies on error
    if (req.session) {
      req.session.destroy();
    }
    res.clearCookie('discord_user', COOKIE_OPTIONS);
    res.clearCookie('discord_token', COOKIE_OPTIONS);

    return res.redirect(`${FRONTEND_URL}/verify?error=auth_failed`);
  }
} 