import expressPkg from 'express';
import dbPool from '../config/database.js';

const router = expressPkg.Router();

router.get('/:discord_id', async (req, res) => {
  const discord_id = req.params.discord_id;
  let client;

  try {
    client = await pool.connect();

    // Check if user exists in user_roles
    const userResult = await client.query(
      'SELECT discord_id FROM user_roles WHERE discord_id = $1',
      [discord_id]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({
        error: 'User not found',
        details: `No user found for Discord ID: ${discord_id}`
      });
    }

    // Get user's NFT holdings from collection_counts
    const query = `
      SELECT 
        COALESCE(celeb_catz_count, 0) as celebcatz_count,
        COALESCE(money_monsters_3d_count, 0) as mm3d_count,
        COALESCE(fcked_catz_count, 0) as fckedcatz_count,
        COALESCE(money_monsters_count, 0) as mm_count,
        COALESCE(aibitbots_count, 0) as aibb_count,
        COALESCE(ai_collabs_count, 0) as ai_collabs_count,
        COALESCE(money_monsters_top_10, 0) as money_monsters_top_10,
        COALESCE(money_monsters_3d_top_10, 0) as money_monsters_3d_top_10,
        COALESCE(branded_catz_count, 0) as branded_catz_count,
        COALESCE(total_count, 0) as total_count
      FROM collection_counts 
      WHERE discord_id = $1
    `;

    const result = await client.query(query, [discord_id]);
    
    if (!result.rows[0]) {
      return res.json({
        celebcatz_count: 0,
        mm3d_count: 0,
        fckedcatz_count: 0,
        mm_count: 0,
        aibb_count: 0,
        ai_collabs_count: 0,
        money_monsters_top_10: 0,
        money_monsters_3d_top_10: 0,
        branded_catz_count: 0,
        total_count: 0
      });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching collection counts:', error);
    return res.status(500).json({
      error: 'Failed to fetch collection counts',
      details: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

export default router; 