import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import dotenv from 'dotenv';
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
const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_ORIGIN = runtime.frontendUrl;

app.set('trust proxy', 1);
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

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
