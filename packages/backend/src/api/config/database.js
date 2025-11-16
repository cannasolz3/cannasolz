import pg from 'pg';
const { Pool } = pg;

// In production, environment variables are set through the platform
// In development, we load from .env file
if (process.env.NODE_ENV !== 'production') {
  const { fileURLToPath } = await import('url');
  const { dirname, resolve } = await import('path');
  const { default: dotenv } = await import('dotenv');
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // Load .env file in development only
  dotenv.config({ path: resolve(__dirname, '../../.env') });
}

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL environment variable is required');
}

// Parse the connection string
const connectionString = process.env.POSTGRES_URL;

console.log('Initializing database connection pool...', {
  environment: process.env.NODE_ENV,
  hasConnectionString: !!connectionString,
  ssl: process.env.NODE_ENV === 'production'
});

// Create or reuse a singleton pool (prevents redeclaration in bundled serverless)
let pool = globalThis.__CANNASOLZ_DB_POOL;
if (!pool) {
  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false
    } : false,
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    maxUses: 1000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5000,
    statement_timeout: 10000,
    idle_in_transaction_session_timeout: 10000,
    query_timeout: 10000
  });
  globalThis.__CANNASOLZ_DB_POOL = pool;
}

// Attach listeners only once
if (!globalThis.__CANNASOLZ_DB_POOL_LISTENERS_ATTACHED) {
  // Add pool error handler with reconnection logic
  pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    if (err.code === '25P03') {
      try {
        client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error rolling back timed out transaction:', rollbackError);
      }
    }
  });
  // Add pool connect handler with logging
  pool.on('connect', client => {
    console.log('New client connected to pool');
    client.query(`
      SET statement_timeout = 10000;
      SET idle_in_transaction_session_timeout = 10000;
      SET lock_timeout = 5000;
      SET tcp_keepalives_idle = 30;
      SET tcp_keepalives_interval = 5;
      SET tcp_keepalives_count = 3;
    `).catch(err => {
      console.error('Error configuring client session:', err);
    });
  });
  // Add pool acquire/remove handlers
  pool.on('acquire', () => console.log('Client acquired from pool'));
  pool.on('remove', () => console.log('Client removed from pool'));
  globalThis.__CANNASOLZ_DB_POOL_LISTENERS_ATTACHED = true;
}

// Health check function
async function healthCheck() {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('Pool health check successful');
    return true;
  } catch (error) {
    console.error('Pool health check failed:', error);
    return false;
  }
}

// Configure a single client for serverless environment
let client = null;
let connecting = null;

async function getClient() {
  // Return existing client if it's already connected
  if (client?.connection?.stream?.readable) {
    console.log('Reusing existing database connection');
    return client;
  }

  // Wait for existing connection attempt if one is in progress
  if (connecting) {
    console.log('Waiting for existing connection attempt...');
    return connecting;
  }

  console.log('Initiating new database connection...');

  // Create new connection with retries
  connecting = new Promise(async (resolve, reject) => {
    let attempts = 3;
    let delay = 1000;

    while (attempts > 0) {
      try {
        client = await pool.connect();
        console.log('Successfully connected to database');
        
        // Configure client session
        await client.query(`
          SET statement_timeout = 10000;
          SET idle_in_transaction_session_timeout = 10000;
          SET tcp_keepalives_idle = 30;
          SET tcp_keepalives_interval = 5;
          SET tcp_keepalives_count = 3;
        `);
        
        // Handle connection errors
        client.on('error', err => {
          console.error('Client error:', err);
          client = null;
        });

        // Test the connection
        const result = await client.query('SELECT NOW()');
        console.log('Database connection test successful:', result.rows[0]);

        resolve(client);
        break;
      } catch (error) {
        attempts--;
        console.error('Database connection attempt failed:', {
          message: error.message,
          code: error.code,
          attemptsLeft: attempts,
          delay
        });
        
        if (attempts === 0) {
          client = null;
          reject(error);
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }).finally(() => {
    connecting = null;
  });

  return connecting;
}

// Export both pool and getClient
export default pool;
export { getClient, healthCheck };
