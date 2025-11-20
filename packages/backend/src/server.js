import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import expressPkg from 'express';
import cors from 'cors';
import session from 'express-session';
import dotenv from 'dotenv';
import { verifyKey } from 'discord-interactions';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const { getRuntimeConfig } = await import('./config/runtime.js');
const authHandler = (await import('./api/auth/index.js')).default;
const userRouter = (await import('./api/user/index.js')).default;
const collectionCountsRouter = (await import('./api/collection-counts/index.js')).default;
const rewardsEventsHandler = (await import('./api/rewards/events.js')).default;
const processDailyRewardsHandler = (await import('./api/rewards/process-daily.js')).default;

const runtime = getRuntimeConfig();
const app = expressPkg();
const PORT = process.env.PORT || 3001;
const FRONTEND_ORIGIN = runtime.frontendUrl;

app.set('trust proxy', 1);

// CORS - apply to all routes EXCEPT Discord interactions
app.use((req, res, next) => {
  // Skip CORS for Discord interactions - Discord doesn't like CORS headers
  if (req.path === '/api/discord/interactions' || req.path === '/api/discord-interactions') {
    return next();
  }
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true
  })(req, res, next);
});

// Discord interactions endpoint needs special handling - exclude from global middleware
app.use((req, res, next) => {
  if ((req.path === '/api/discord/interactions' || req.path === '/api/discord-interactions') && req.method === 'POST') {
    // Skip all middleware for Discord interactions - handle in router
    return next();
  }
  // Apply JSON parser for all other routes
  expressPkg.json({ limit: '5mb' })(req, res, next);
});

app.use(expressPkg.urlencoded({ extended: true }));

// Session middleware - exclude Discord interactions
app.use((req, res, next) => {
  if ((req.path === '/api/discord/interactions' || req.path === '/api/discord-interactions') && req.method === 'POST') {
    return next();
  }
  session({
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
  })(req, res, next);
});

const wrapHandler = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
    if (!res.headersSent) {
      res.end();
    }
  } catch (error) {
    next(error);
  }
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok', project: runtime.project?.name || 'CannaSolz' });
});

app.use('/api/user', userRouter);
app.use('/api/collection-counts', collectionCountsRouter);
app.use('/api/auth', wrapHandler(authHandler));
app.get('/api/rewards/events', wrapHandler(rewardsEventsHandler));
app.post('/api/rewards/process-daily', wrapHandler(processDailyRewardsHandler));

// Discord role sync endpoint
const discordSyncHandler = (await import('./api/integrations/discord/sync.js')).default;
app.post('/api/discord/sync', wrapHandler(discordSyncHandler));

// Discord interactions endpoint (for slash commands)
// Use express.raw() directly in route handler like working BUXDAO implementation
const { handleCommand } = await import('./api/integrations/discord/commands.js');

// Shared handler function
const discordInteractionHandler = async (req, res) => {
  try {
    console.log('[Discord] Interaction hit:', {
      time: new Date().toISOString(),
      contentType: req.headers['content-type'],
      userAgent: req.headers['user-agent'],
      hasSig: !!req.headers['x-signature-ed25519'],
      hasTs: !!req.headers['x-signature-timestamp']
    });
    
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    // Use the exact raw body buffer for signature verification
    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    const strBody = rawBody.toString('utf8');

    // Parse interaction first
    let interaction;
    try {
      interaction = JSON.parse(strBody);
    } catch (e) {
      console.error('[Discord] JSON parse error:', e.message);
      return res.status(400).send('Bad Request');
    }

    console.log('[Discord] Raw length:', rawBody.length, 'Parsed type:', interaction?.type);

    // Verify the request is from Discord (required for all interactions including PING)
    const isValidRequest = await verifyKey(
      rawBody,
      signature,
      timestamp,
      process.env.DISCORD_PUBLIC_KEY
    );

    console.log('[Discord] Verified:', isValidRequest, 'Type:', interaction?.type, 'Cmd:', interaction?.data?.name);

    // Reply to PING (type 1) only if signature is valid
    if (interaction?.type === 1) {
      if (!isValidRequest) {
        return res.status(401).send('Invalid request signature');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"type":1}');
    }

    if (!isValidRequest) {
      return res.status(401).send('Invalid request signature');
    }

    // Handle application commands
    if (interaction.type === 2 && interaction.data) {
      const response = await handleCommand(interaction);
      return res.json(response);
    }

    return res.json({ type: 4, data: { content: 'Unknown interaction type', flags: 64 } });
  } catch (error) {
    console.error('[Discord] Critical interaction error:', error);
    return res.json({ type: 4, data: { content: 'An error occurred processing the command', flags: 64 } });
  }
};

app.post('/api/discord-interactions', expressPkg.raw({ type: '*/*' }), discordInteractionHandler);
app.post('/api/discord/interactions', expressPkg.raw({ type: '*/*' }), discordInteractionHandler);

app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Only start a listener when running locally (not in Vercel serverless)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
  });
}

export default app;
