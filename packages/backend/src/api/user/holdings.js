import dbPool from '../config/database.js';
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
    const client = await dbPool.connect();

    try {
      const discordId = req.session.user.discord_id;

      const [countsResult, walletsResult] = await Promise.all([
        client.query(
          `
            SELECT 
              COALESCE(gold_count, 0) as gold_count,
              COALESCE(silver_count, 0) as silver_count,
              COALESCE(purple_count, 0) as purple_count,
              COALESCE(dark_green_count, 0) as dark_green_count,
              COALESCE(light_green_count, 0) as light_green_count,
              COALESCE(og420_count, 0) as og420_count,
              COALESCE(total_count, 0) as total_count,
              COALESCE(cnft_gold_count, 0) as cnft_gold_count,
              COALESCE(cnft_silver_count, 0) as cnft_silver_count,
              COALESCE(cnft_purple_count, 0) as cnft_purple_count,
              COALESCE(cnft_dark_green_count, 0) as cnft_dark_green_count,
              COALESCE(cnft_light_green_count, 0) as cnft_light_green_count,
              COALESCE(cnft_total_count, 0) as cnft_total_count
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

      const counts = countsResult.rows[0] || {};
      const walletAddresses = walletsResult.rows.map(row => row.wallet_address).filter(Boolean);
      
      // Extract cNFT counts from collection_counts
      const cnftCounts = {
        gold: counts.cnft_gold_count || 0,
        silver: counts.cnft_silver_count || 0,
        purple: counts.cnft_purple_count || 0,
        dark_green: counts.cnft_dark_green_count || 0,
        light_green: counts.cnft_light_green_count || 0,
        total: counts.cnft_total_count || 0
      };

      // Daily yield rates per NFT (regular NFTs)
      const yieldRates = {
        og420: 50,
        gold: 30,
        silver: 25,
        purple: 20,
        dark_green: 15,
        light_green: 10
      };

      // Daily yield rates per cNFT (seedlings)
      const cnftYieldRates = {
        gold: 5,
        silver: 4,
        purple: 3,
        dark_green: 2,
        light_green: 1
      };

      // Calculate daily yield for each color (regular NFTs)
      const dailyYields = {
        og420: (counts.og420_count || 0) * yieldRates.og420,
        gold: (counts.gold_count || 0) * yieldRates.gold,
        silver: (counts.silver_count || 0) * yieldRates.silver,
        purple: (counts.purple_count || 0) * yieldRates.purple,
        dark_green: (counts.dark_green_count || 0) * yieldRates.dark_green,
        light_green: (counts.light_green_count || 0) * yieldRates.light_green
      };

      // Calculate daily yield for each color (cNFTs)
      const cnftDailyYields = {
        gold: (Number(cnftCounts.gold_count) || 0) * cnftYieldRates.gold,
        silver: (Number(cnftCounts.silver_count) || 0) * cnftYieldRates.silver,
        purple: (Number(cnftCounts.purple_count) || 0) * cnftYieldRates.purple,
        dark_green: (Number(cnftCounts.dark_green_count) || 0) * cnftYieldRates.dark_green,
        light_green: (Number(cnftCounts.light_green_count) || 0) * cnftYieldRates.light_green
      };

      // Total daily yield (NFTs + cNFTs)
      const totalDailyYield = Object.values(dailyYields).reduce((sum, dailyYield) => sum + dailyYield, 0) +
                              Object.values(cnftDailyYields).reduce((sum, dailyYield) => sum + dailyYield, 0);

      let nfts = [];
      let cnfts = [];
      if (walletAddresses.length > 0) {
        const [nftResult, cnftResult] = await Promise.all([
          client.query(
            `
              SELECT mint_address, name, image_url, leaf_colour, og420
              FROM nft_metadata
              WHERE owner_wallet = ANY($1::text[])
              AND (symbol IS NULL OR symbol NOT LIKE 'seedling_%')
              ORDER BY name NULLS LAST
            `,
            [walletAddresses]
          ),
          client.query(
          `
              SELECT mint_address, name, image_url, symbol
            FROM nft_metadata
            WHERE owner_wallet = ANY($1::text[])
              AND symbol LIKE 'seedling_%'
            ORDER BY name NULLS LAST
          `,
          [walletAddresses]
          )
        ]);
        nfts = nftResult.rows;
        cnfts = cnftResult.rows;
      }

      return res.json({
        collection: {
          name: 'CannaSolz',
          count: counts.total_count || 0,
          daily_yield: totalDailyYield
        },
        counts: {
          og420: counts.og420_count || 0,
          gold: counts.gold_count || 0,
          silver: counts.silver_count || 0,
          purple: counts.purple_count || 0,
          dark_green: counts.dark_green_count || 0,
          light_green: counts.light_green_count || 0,
          total: counts.total_count || 0
        },
        cnft_counts: {
          gold: Number(cnftCounts.gold) || 0,
          silver: Number(cnftCounts.silver) || 0,
          purple: Number(cnftCounts.purple) || 0,
          dark_green: Number(cnftCounts.dark_green) || 0,
          light_green: Number(cnftCounts.light_green) || 0,
          total: Number(cnftCounts.total) || 0
        },
        daily_yields: {
          og420: dailyYields.og420,
          gold: dailyYields.gold,
          silver: dailyYields.silver,
          purple: dailyYields.purple,
          dark_green: dailyYields.dark_green,
          light_green: dailyYields.light_green,
          total: totalDailyYield
        },
        cnft_daily_yields: {
          gold: cnftDailyYields.gold,
          silver: cnftDailyYields.silver,
          purple: cnftDailyYields.purple,
          dark_green: cnftDailyYields.dark_green,
          light_green: cnftDailyYields.light_green,
          total: Object.values(cnftDailyYields).reduce((sum, y) => sum + y, 0)
        },
        nfts,
        cnfts
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error fetching user holdings:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
