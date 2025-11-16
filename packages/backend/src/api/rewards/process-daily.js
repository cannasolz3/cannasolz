import dbPool from '../config/database.js';

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify secret token for cron or admin auth for manual trigger
  const secretToken = req.headers['x-secret-token'];
  const isAdmin = req.session?.user?.roles?.includes('admin');
  
  if (!secretToken && !isAdmin) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (secretToken && secretToken !== process.env.CRON_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Invalid secret token' });
  }

  try {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Call the process_pending_rewards function
      await client.query('SELECT process_pending_rewards()');

      // Get stats about processed rewards
      const stats = await client.query(`
        SELECT 
          COUNT(*) as processed_count,
          SUM(total_daily_reward) as total_rewards,
          MAX(processed_at) as last_processed
        FROM daily_rewards
        WHERE processed_at >= date_trunc('day', CURRENT_TIMESTAMP)
        AND processed_at < date_trunc('day', CURRENT_TIMESTAMP + interval '1 day')
      `);

      // Notify connected clients about the update
      await client.query(`
        NOTIFY rewards_processed, '${JSON.stringify({
          processed_count: stats.rows[0].processed_count,
          total_rewards: stats.rows[0].total_rewards,
          last_processed: stats.rows[0].last_processed
        })}';
      `);

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Daily rewards processed successfully',
        stats: stats.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error processing daily rewards:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
} 