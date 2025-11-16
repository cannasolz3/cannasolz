import expressPkg from 'express';
import { pool } from '../config/database.js';

const router = expressPkg.Router();

router.get('/', async (req, res) => {
  let client;
  try {
    const { collection = 'all', type = 'bux,nfts' } = req.query;
    
    client = await pool.connect();
    
    let query = `
      SELECT 
        cc.wallet_address,
        cc.discord_name,
        cc.total_count,
        bh.balance as bux_balance
      FROM collection_counts cc
      LEFT JOIN token_holders bh ON bh.wallet_address = cc.wallet_address
      WHERE 1=1
    `;

    // Add collection filter if not 'all'
    if (collection !== 'all') {
      const collectionMap = {
        'fckedcatz': 'fcked_catz_count',
        'moneymonsters': 'money_monsters_count',
        'aibitbots': 'aibitbots_count',
        'moneymonsters3d': 'money_monsters_3d_count',
        'celebcatz': 'celeb_catz_count'
      };
      
      const columnName = collectionMap[collection];
      if (columnName) {
        query += ` AND cc.${columnName} > 0`;
      }
    }

    // Add order by based on view type
    if (type === 'bux') {
      query += ' ORDER BY bh.balance DESC NULLS LAST';
    } else if (type === 'nfts') {
      query += ' ORDER BY cc.total_count DESC';
    } else {
      // Combined view - order by both
      query += ' ORDER BY COALESCE(bh.balance, 0) DESC, cc.total_count DESC';
    }

    query += ' LIMIT 100';

    const result = await client.query(query);
    
    res.json({
      holders: result.rows
    });

  } catch (error) {
    console.error('Error fetching top holders:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

export default router; 