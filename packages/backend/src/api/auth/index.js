import { parse, serialize } from 'cookie';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { pool } from '../config/database.js';
import { getRuntimeConfig } from '../../config/runtime.js';

// Log environment variables being accessed
console.log('Auth module environment check:', {
  POSTGRES_URL: !!process.env.POSTGRES_URL,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  NODE_ENV: process.env.NODE_ENV
});

// Use shared pool from config/database.js

// Runtime configuration
const runtime = getRuntimeConfig();
const FRONTEND_URL = runtime.frontendUrl;
const API_URL = runtime.apiBaseUrl;
function getOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `${proto}://${host}` : API_URL;
}
function getCallbackUrl(req) {
  const envOverride = process.env.DISCORD_REDIRECT_URI;
  if (envOverride) return envOverride;
  return `${getOrigin(req)}/api/auth/discord/callback`;
}
const DISCORD_CLIENT_ID = runtime.discord.clientId;
const DISCORD_CLIENT_SECRET = runtime.discord.clientSecret;

function mapDiscordUser(raw) {
  if (!raw) return null;
  const discordId = raw.id || raw.discord_id;
  const username = raw.username || raw.discord_username;
  if (!discordId || !username) {
    return null;
  }
  const displayName = raw.discord_display_name || raw.global_name || raw.display_name || username;
  return {
    discord_id: discordId,
    discord_username: username,
    discord_display_name: displayName,
    avatar: raw.avatar || null
  };
}

async function syncDiscordDisplayName(discordUser) {
  if (!discordUser) return;
  const discordId = discordUser.discord_id;
  const displayName = discordUser.discord_display_name || discordUser.discord_username;
  if (!discordId || !displayName) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO user_roles (discord_id, discord_name)
       VALUES ($1, $2)
       ON CONFLICT (discord_id) DO UPDATE SET discord_name = EXCLUDED.discord_name`,
      [discordId, displayName]
    );

    const updateStatements = [
      'UPDATE user_wallets SET discord_name = $2 WHERE discord_id = $1',
      'UPDATE collection_counts SET discord_name = $2 WHERE discord_id = $1',
      'UPDATE claim_accounts SET discord_name = $2 WHERE discord_id = $1',
      'UPDATE daily_rewards SET discord_name = $2 WHERE discord_id = $1'
    ];

    for (const statement of updateStatements) {
      await client.query(statement, [discordId, displayName]);
    }

    await client.query(
      'UPDATE token_holders SET owner_name = $2 WHERE owner_discord_id = $1',
      [discordId, displayName]
    );
    await client.query(
      'UPDATE nft_metadata SET owner_name = $2 WHERE owner_discord_id = $1',
      [discordId, displayName]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Auth] Failed to sync Discord display name:', error);
  } finally {
    client.release();
  }
}

if (!DISCORD_CLIENT_ID || DISCORD_CLIENT_ID === 'undefined') {
  console.error('Environment check failed:', {
    DISCORD_CLIENT_ID_TYPE: typeof DISCORD_CLIENT_ID,
    DISCORD_CLIENT_ID_VALUE: DISCORD_CLIENT_ID,
    ENV_KEYS: Object.keys(process.env)
  });
  throw new Error('DISCORD_CLIENT_ID environment variable is not configured');
}

if (!DISCORD_CLIENT_SECRET || DISCORD_CLIENT_SECRET === 'undefined') {
  throw new Error('DISCORD_CLIENT_SECRET environment variable is not configured');
}

// Cookie settings
const COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  secure: runtime.cookies.secure,
  sameSite: runtime.cookies.secure ? 'none' : 'lax',
  domain: runtime.cookies.domain
};

export default async function handler(req, res) {
  try {
    // Get the endpoint from the URL path
    const parts = req.url.split('?')[0].split('/').filter(Boolean);
    console.log('[Auth Debug] URL:', req.url);
    console.log('[Auth Debug] Path parts:', parts);
    
    // Special case for discord callback
    if (parts.length >= 2 && parts[0] === 'discord' && parts[1] === 'callback') {
      console.log('[Auth Debug] Handling Discord callback');
      return handleDiscordCallback(req, res);
    }

    const endpoint = parts[0];
    console.log('[Auth Debug] Endpoint:', endpoint);

    if (!endpoint) {
      return res.status(404).json({ error: 'Not found' });
    }

    switch(endpoint) {
      case 'check':
        return handleCheck(req, res);
      case 'process':
        return handleProcess(req, res);
      case 'discord':
        return handleDiscordAuth(req, res);
      case 'wallet':
      case 'update-wallet':
        return handleWallet(req, res);
      case 'roles':
        const handleRoles = (await import('./roles.js')).default;
        return handleRoles(req, res);
      case 'logout':
        return handleLogout(req, res);
      default:
        console.log('[Auth] No matching endpoint:', endpoint);
        return res.status(404).json({ error: 'Not found' });
    }
  } catch (error) {
    console.error('[Auth] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message,
      url: req.url
    });
  }
}

// Check auth status
async function handleCheck(req, res) {
  try {
    const cookies = parse(req.headers.cookie || '');
    const cookieUser = cookies.discord_user ? JSON.parse(cookies.discord_user) : null;
    const discordUser = cookieUser ? mapDiscordUser(cookieUser) : null;

    if (!discordUser) {
      return res.status(200).json({ authenticated: false });
    }

    // Initialize session if not already set
    if (!req.session.user && discordUser) {
      req.session.user = {
        discord_id: discordUser.discord_id,
        discord_username: discordUser.discord_username,
        discord_display_name: discordUser.discord_display_name,
        avatar: discordUser.avatar,
        access_token: cookies.discord_token
      };
      await req.session.save();
    }

    // Fetch wallet address from database
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT wallet_address FROM user_wallets WHERE discord_id = $1 ORDER BY is_primary DESC, last_used DESC LIMIT 1',
        [discordUser.discord_id]
      );
      
      const walletAddress = result.rows[0]?.wallet_address;
      
      // Update session with wallet address
      if (walletAddress && req.session.user) {
        req.session.user.wallet_address = walletAddress;
        await req.session.save();
      }

      return res.status(200).json({ 
        authenticated: true,
        user: {
          ...discordUser,
          wallet_address: walletAddress
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[Auth Check] Error:', error);
    return res.status(500).json({ error: 'Failed to check authentication status' });
  }
}

// Process auth
async function handleProcess(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'No code provided' });
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: FRONTEND_URL + '/verify',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to get token from Discord');
    }

    const tokenData = await tokenResponse.json();
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error('Failed to get user data from Discord');
    }

    const userData = await userResponse.json();
    await setAuthCookies(req, res, tokenData.access_token, userData);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Auth process error:', error);
    return res.status(500).json({ error: 'Failed to process authentication' });
  }
}

// Initiate Discord auth
async function handleDiscordAuth(req, res) {
  try {
    // Generate state for security
    const state = crypto.randomBytes(16).toString('hex');
    console.log('[Discord Auth] Generated state:', state);
    
    // Set state cookie first
    // Important: make state cookie host-only (no domain) to avoid cross-domain mismatch on Vercel
    const stateCookieOptions = {
      path: '/',
      httpOnly: true,
      secure: runtime.cookies.secure,
      // Lax sends cookie on top-level GET navigations (like OAuth callback)
      sameSite: runtime.cookies.secure ? 'lax' : 'lax',
      maxAge: 300
    };
    console.log('[Discord Auth] State cookie options:', stateCookieOptions, 'cookieDomainRuntime:', runtime.cookies.domain, 'origin:', getOrigin(req));
    const stateCookie = serialize('discord_state', state, stateCookieOptions);
    
    // Build Discord OAuth URL with required parameters
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: getCallbackUrl(req),
      response_type: 'code',
      scope: 'identify guilds.join',
      state: state,
      prompt: 'consent'
    });
    
    const discordUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;
    console.log('[Discord Auth] Full auth URL:', discordUrl);

    res.setHeader('Set-Cookie', stateCookie);
    res.setHeader('Location', discordUrl);
    return res.status(302).end();
  } catch (error) {
    console.error('[Discord Auth] Error:', error);
    res.setHeader('Location', `${FRONTEND_URL}/?error=${encodeURIComponent(error.message)}`);
    return res.status(302).end();
  }
}

// Handle Discord callback
async function handleDiscordCallback(req, res) {
  console.log('[Discord Callback] Received callback with query:', req.query);
  console.log('[Discord Callback] Cookies:', req.headers.cookie);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, state } = req.query;
    const cookies = parse(req.headers.cookie || '');
    const storedState = cookies.discord_state;

    console.log('[Discord Callback] Verifying state:', { 
      received: state,
      stored: storedState
    });

    if (!storedState || storedState !== state) {
      console.error('[Discord Callback] State mismatch or missing');
      res.setHeader('Location', `${FRONTEND_URL}/?error=${encodeURIComponent('Invalid state parameter')}`);
      return res.status(302).end();
    }

    // Exchange code for token
    console.log('[Discord Callback] Exchanging code for token...');
    const callbackUrl = getCallbackUrl(req);
    console.log('[Discord Callback] Using callback URL:', callbackUrl);
    
    const tokenParams = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: callbackUrl
    });
    
    console.log('[Discord Callback] Token request params:', tokenParams.toString());
    
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: tokenParams.toString()
    });

    const tokenText = await tokenResponse.text();
    console.log('[Discord Callback] Token response status:', tokenResponse.status);
    console.log('[Discord Callback] Token response headers:', tokenResponse.headers.raw());
    console.log('[Discord Callback] Token response body:', tokenText);

    if (!tokenResponse.ok) {
      console.error('[Discord Callback] Token error:', tokenText);
      res.setHeader('Location', `${FRONTEND_URL}/?error=${encodeURIComponent('Failed to get token: ' + tokenText)}`);
      return res.status(302).end();
    }

    let tokenData;
    try {
      tokenData = JSON.parse(tokenText);
    } catch (e) {
      console.error('[Discord Callback] Failed to parse token response:', e);
      res.setHeader('Location', `${FRONTEND_URL}/?error=${encodeURIComponent('Invalid token response')}`);
      return res.status(302).end();
    }

    if (!tokenData.access_token) {
      console.error('[Discord Callback] No access token in response');
      res.setHeader('Location', `${FRONTEND_URL}/?error=${encodeURIComponent('No access token received')}`);
      return res.status(302).end();
    }

    console.log('[Discord Callback] Successfully got access token');

    // Get user data
    console.log('[Discord Callback] Fetching user data...');
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json'
      }
    });

    const userText = await userResponse.text();
    console.log('[Discord Callback] User response status:', userResponse.status);
    console.log('[Discord Callback] User response headers:', userResponse.headers.raw());
    console.log('[Discord Callback] User response body:', userText);

    if (!userResponse.ok) {
      console.error('[Discord Callback] User data error:', userText);
      res.setHeader('Location', `${FRONTEND_URL}/?error=${encodeURIComponent('Failed to get user data: ' + userText)}`);
      return res.status(302).end();
    }

    let userData;
    try {
      userData = JSON.parse(userText);
    } catch (e) {
      console.error('[Discord Callback] Failed to parse user data:', e);
      res.setHeader('Location', `${FRONTEND_URL}/?error=${encodeURIComponent('Invalid user data response')}`);
      return res.status(302).end();
    }

    if (!userData.id || !userData.username) {
      console.error('[Discord Callback] Invalid user data:', userData);
      res.setHeader('Location', `${FRONTEND_URL}/?error=${encodeURIComponent('Invalid user data received')}`);
      return res.status(302).end();
    }

  const cookieUser = mapDiscordUser(userData);
  if (!cookieUser) {
    throw new Error('Failed to map Discord user profile');
  }
  console.log('[Discord Callback] Got user data for:', cookieUser.discord_display_name);

  await syncDiscordDisplayName(cookieUser);

  // Set auth cookies
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  const responseCookies = [
    serialize('discord_token', tokenData.access_token, {
      ...COOKIE_OPTIONS,
      maxAge: oneWeek,
    }),
    serialize('discord_user', JSON.stringify(cookieUser), {
      ...COOKIE_OPTIONS,
      maxAge: oneWeek,
    })
  ];

  console.log('[Discord Callback] Setting cookies:', responseCookies);
  res.setHeader('Set-Cookie', responseCookies);

    // Redirect to verify page
    console.log('[Discord Callback] Redirecting to verify page');
    res.setHeader('Location', `${FRONTEND_URL}/`);
    return res.status(302).end();
  } catch (error) {
    console.error('[Discord Callback] Error:', error);
    res.setHeader('Location', `${FRONTEND_URL}/?error=${encodeURIComponent(error.message)}`);
    return res.status(302).end();
  }
}

// Handle wallet verification
async function handleWallet(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[Wallet Debug] Request body:', req.body);
    
    const cookies = parse(req.headers.cookie || '');
    console.log('[Wallet Debug] Cookies:', cookies);
    
    if (!cookies.discord_user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userRaw = cookies.discord_user ? JSON.parse(cookies.discord_user) : null;
    const user = userRaw ? mapDiscordUser(userRaw) : null;
    console.log('[Wallet Debug] User data:', user);

    const { wallet_address } = req.body;

    if (!wallet_address) {
      return res.status(400).json({ error: 'Missing wallet_address' });
    }

    if (!user.discord_id) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Update database
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      console.log('[Wallet Debug] Inserting into user_wallets for discord_id:', user.discord_id);
      
      // Insert into user_wallets first, which will trigger creation of other entries
      const result = await client.query(
        'INSERT INTO user_wallets (discord_id, wallet_address, discord_name, is_primary) VALUES ($1, $2, $3, true) ON CONFLICT (discord_id, wallet_address) DO UPDATE SET last_used = CURRENT_TIMESTAMP, discord_name = EXCLUDED.discord_name RETURNING *',
        [user.discord_id, wallet_address, user.discord_display_name || user.discord_username]
      );

      console.log('[Wallet Debug] user_wallets insert result:', result.rows[0]);

      await client.query('COMMIT');
      await syncDiscordDisplayName(user);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('[Wallet Debug] Database error:', error);
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[Wallet Debug] Error:', error);
    return res.status(500).json({ error: 'Failed to verify wallet' });
  }
}

// Handle logout
async function handleLogout(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const cookies = parse(req.headers.cookie || '');
    const discordToken = cookies.discord_token;

    if (discordToken) {
      try {
        // Attempt to revoke Discord token
        await fetch('https://discord.com/api/oauth2/token/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            token: discordToken,
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
          })
        });
      } catch (error) {
        console.error('Failed to revoke Discord token:', error);
      }
    }

    clearAuthCookies(res);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Failed to logout' });
  }
}

// Helper functions
async function setAuthCookies(req, res, token, user) {
  const cookieUser = mapDiscordUser(user);
  if (!cookieUser) {
    throw new Error('Invalid Discord user payload');
  }

  const oneWeek = 7 * 24 * 60 * 60;
  const baseOptions = {
    ...COOKIE_OPTIONS,
    maxAge: oneWeek
  };

  const tokenCookie = serialize('discord_token', token, baseOptions);
  const userCookie = serialize('discord_user', JSON.stringify(cookieUser), baseOptions);

  console.log('[Auth] Setting cookies with options:', baseOptions);
  res.setHeader('Set-Cookie', [tokenCookie, userCookie]);

  if (req.session) {
    req.session.user = {
      discord_id: cookieUser.discord_id,
      discord_username: cookieUser.discord_username,
      discord_display_name: cookieUser.discord_display_name,
      avatar: cookieUser.avatar,
      access_token: token
    };
    await req.session.save();
  }

  await syncDiscordDisplayName(cookieUser);
}

function clearAuthCookies(res) {
  const expiredOptions = {
    ...COOKIE_OPTIONS,
    maxAge: 0
  };

  const cookies = [
    serialize('discord_token', '', expiredOptions),
    serialize('discord_user', '', expiredOptions),
    serialize('discord_state', '', expiredOptions)
  ];

  console.log('[Auth] Clearing cookies:', cookies);
  res.setHeader('Set-Cookie', cookies);
}
 