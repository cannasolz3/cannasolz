import express from 'express';
import crypto from 'crypto';

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production'
  ? 'https://buxdao.com'
  : 'http://localhost:5173');

const API_URL = process.env.API_URL || (process.env.NODE_ENV === 'production'
  ? 'https://api.buxdao.com'
  : 'http://localhost:3001');

const REDIRECT_URI_ENV = process.env.DISCORD_REDIRECT_URI || null;

router.get('/', async (req, res) => {
  try {
    console.log('Discord auth request:', {
      sessionID: req.sessionID,
      hasSession: !!req.session,
      cookies: req.headers.cookie,
      secure: req.secure,
      protocol: req.protocol,
      'x-forwarded-proto': req.headers['x-forwarded-proto']
    });

    // Generate random state
    const state = crypto.randomBytes(32).toString('hex');
    
    // Initialize session
    if (!req.session) {
      req.session = {};
    }

    // Store state in session and cookies
    req.session.discord_state = state;
    res.cookie('discord_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
    
    // Force session save before redirect
    await new Promise((resolve) => req.session.save(resolve));

    // Determine redirect URI
    let redirectUri = REDIRECT_URI_ENV;
    if (!redirectUri) {
      const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const origin = host ? `${proto}://${host}` : API_URL;
      redirectUri = `${origin}/api/auth/discord/callback`;
    }

    // Build Discord OAuth URL
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds.join',
      state: state,
      prompt: 'consent'
    });

    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  } catch (error) {
    console.error('Discord auth error:', error);
    res.redirect(`${FRONTEND_URL}/verify?error=auth_failed`);
  }
});

export default router; 