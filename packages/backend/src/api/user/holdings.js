import { pool } from '../config/database.js';
import { parse } from 'cookie';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Fallback auth: hydrate session from cookie in serverless
  if (!req.session?.user) {
    const cookies = parse(req.headers.cookie || '');
    if (cookies.discord_user) {
      try {
        const user = JSON.parse(cookies.discord_user);
        req.session = req.session || {};
        req.session.user = {
          discord_id: user.id || user.discord_id,
          discord_username: user.username || user.discord_username,
          discord_display_name: user.discord_display_name || user.global_name || user.display_name || user.username,
          avatar: user.avatar || null
        };
      } catch {
        // ignore parse errors
      }
    }
  }

  if (!req.session?.user?.discord_id) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const client = await pool.connect();

    try {
      const discordId = req.session.user.discord_id;

      const [countsResult, walletsResult] = await Promise.all([
        client.query(
          `
            SELECT COALESCE(total_count, 0) as total_count
            FROM collection_counts
            WHERE discord_id = $1
          `,
          [discordId]
        ),
        client.query(
          `
            SELECT wallet_address
            FROM user_wallets
            WHERE discord_id = $1
          `,
          [discordId]
        )
      ]);

      const totalCount = countsResult.rows[0]?.total_count || 0;
      const walletAddresses = walletsResult.rows.map(row => row.wallet_address).filter(Boolean);

      let nfts = [];
      if (walletAddresses.length > 0) {
        const nftResult = await client.query(
          `
            SELECT mint_address, name, image_url, leaf_colour
            FROM nft_metadata
            WHERE owner_wallet = ANY($1::text[])
            ORDER BY name NULLS LAST
          `,
          [walletAddresses]
        );
        nfts = nftResult.rows;
      }

      return res.json({
        collection: {
          name: 'CannaSolz',
          count: totalCount,
          daily_yield: 0
        },
        nfts
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching user holdings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
