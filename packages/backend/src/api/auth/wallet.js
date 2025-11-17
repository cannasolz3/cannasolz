import expressPkg from 'express';
import { PublicKey, Connection } from '@solana/web3.js';
import { parse } from 'cookie';
import pkg from 'pg';
const { Pool } = pkg;
import { pool } from '../config/database.js';

const authWalletRouter = expressPkg.Router();

const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

authWalletRouter.post('/', async (req, res) => {
  try {
    // Check for discord_user cookie
    const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
    const discordUser = cookies.discord_user ? JSON.parse(cookies.discord_user) : null;

    if (!discordUser || !discordUser.discord_id) {
      console.error('Session validation failed:', {
        cookies: !!cookies,
        discordUser: !!discordUser,
        sessionID: req.sessionID
      });
      return res.status(401).json({ 
        success: false,
        error: 'Not authenticated' 
      });
    }

    const { wallet_address } = req.body;
    if (!wallet_address) {
      return res.status(400).json({ 
        success: false,
        error: 'Wallet address is required' 
      });
    }

    // Validate Solana address
    try {
      new PublicKey(wallet_address);
    } catch (err) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid wallet address' 
      });
    }

    // Create database client
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Check if wallet already exists for this user
      const existingWallet = await client.query(
        'SELECT * FROM user_wallets WHERE wallet_address = $1 AND discord_id = $2',
        [wallet_address, discordUser.discord_id]
      );

      if (existingWallet.rows.length === 0) {
        // Insert new wallet for this user
        await client.query(
          'INSERT INTO user_wallets (wallet_address, discord_id, discord_username) VALUES ($1, $2, $3)',
          [wallet_address, discordUser.discord_id, discordUser.discord_username]
        );
      }

      // Sync ownership in nft_metadata for this wallet
      await client.query(
        `
          UPDATE nft_metadata
          SET owner_discord_id = $1,
              owner_name = $2
          WHERE owner_wallet = $3
        `,
        [discordUser.discord_id, discordUser.discord_username, wallet_address]
      );

      // First ensure cNFT columns exist
      try {
        await client.query(`
          ALTER TABLE collection_counts 
          ADD COLUMN IF NOT EXISTS cnft_gold_count INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS cnft_silver_count INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS cnft_purple_count INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS cnft_dark_green_count INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS cnft_light_green_count INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS cnft_total_count INTEGER DEFAULT 0
        `);
      } catch (error) {
        // Columns might already exist, ignore
        if (error.code !== '42701') console.error('Error adding cNFT columns:', error.message);
      }

      // Upsert collection_counts per-colour and totals for this user (separate NFTs and cNFTs)
      await client.query(
        `
          INSERT INTO collection_counts (
            discord_id, discord_name,
            gold_count, silver_count, purple_count, dark_green_count, light_green_count,
            og420_count, total_count,
            cnft_gold_count, cnft_silver_count, cnft_purple_count, cnft_dark_green_count, cnft_light_green_count, cnft_total_count,
            last_updated
          )
          SELECT
            $1 AS discord_id,
            $2 AS discord_name,
            -- Regular NFTs by leaf_colour (exclude cNFTs)
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Gold' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) AS gold_count,
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Silver' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) AS silver_count,
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Purple' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) AS purple_count,
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Dark green' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) AS dark_green_count,
            COUNT(*) FILTER (WHERE nm.leaf_colour = 'Light green' AND (nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%')) AS light_green_count,
            COUNT(*) FILTER (WHERE nm.og420 = TRUE) AS og420_count,
            COUNT(*) FILTER (WHERE nm.symbol IS NULL OR nm.symbol NOT LIKE 'seedling_%') AS total_count,
            -- cNFTs by symbol
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_gold') AS cnft_gold_count,
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_silver') AS cnft_silver_count,
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_purple') AS cnft_purple_count,
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_dark_green') AS cnft_dark_green_count,
            COUNT(*) FILTER (WHERE nm.symbol = 'seedling_light_green') AS cnft_light_green_count,
            COUNT(*) FILTER (WHERE nm.symbol LIKE 'seedling_%') AS cnft_total_count,
            NOW() AS last_updated
          FROM nft_metadata nm
          WHERE EXISTS (
            SELECT 1 FROM user_wallets uw 
            WHERE uw.discord_id = $1 
            AND uw.wallet_address = nm.owner_wallet
          )
          ON CONFLICT (discord_id) DO UPDATE SET
            discord_name = EXCLUDED.discord_name,
            gold_count = EXCLUDED.gold_count,
            silver_count = EXCLUDED.silver_count,
            purple_count = EXCLUDED.purple_count,
            dark_green_count = EXCLUDED.dark_green_count,
            light_green_count = EXCLUDED.light_green_count,
            og420_count = EXCLUDED.og420_count,
            total_count = EXCLUDED.total_count,
            cnft_gold_count = EXCLUDED.cnft_gold_count,
            cnft_silver_count = EXCLUDED.cnft_silver_count,
            cnft_purple_count = EXCLUDED.cnft_purple_count,
            cnft_dark_green_count = EXCLUDED.cnft_dark_green_count,
            cnft_light_green_count = EXCLUDED.cnft_light_green_count,
            cnft_total_count = EXCLUDED.cnft_total_count,
            last_updated = NOW()
        `,
        [discordUser.discord_id, discordUser.discord_username]
      );

      await client.query('COMMIT');

      res.json({ 
        success: true,
        message: 'Wallet verified successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Wallet verification error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

export default authWalletRouter; 