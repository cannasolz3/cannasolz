/**
 * Discord interactions endpoint - STANDALONE serverless function
 * Matches the working BUXDAO implementation exactly
 */

import { verifyKey } from 'discord-interactions';

export default async function handler(req, res) {
  try {
    // Log for debugging
    console.log('[Discord] Interaction hit:', {
      time: new Date().toISOString(),
      contentType: req.headers['content-type'],
      userAgent: req.headers['user-agent'],
      hasSig: !!req.headers['x-signature-ed25519'],
      hasTs: !!req.headers['x-signature-timestamp']
    });

    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];

    // Get raw body - Vercel may parse it, so we need to reconstruct it
    let rawBody;
    if (req.body instanceof Buffer) {
      rawBody = req.body;
    } else if (typeof req.body === 'string') {
      rawBody = Buffer.from(req.body, 'utf8');
    } else if (req.body) {
      // Body was parsed as JSON - reconstruct it
      rawBody = Buffer.from(JSON.stringify(req.body), 'utf8');
    } else {
      return res.status(400).json({ error: 'Missing request body' });
    }

    // Parse interaction for type checking
    let interaction;
    try {
      interaction = JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
      console.error('[Discord] JSON parse error:', e.message);
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    console.log('[Discord] Raw length:', rawBody.length, 'Parsed type:', interaction?.type);

    // Verify the request is from Discord using the exact raw body buffer
    const isValidRequest = await verifyKey(
      rawBody,
      signature,
      timestamp,
      process.env.DISCORD_PUBLIC_KEY
    );

    console.log('[Discord] Verified:', isValidRequest, 'Type:', interaction?.type, 'Cmd:', interaction?.data?.name);

    // Handle PING (type 1) - respond immediately with exact format
    if (interaction?.type === 1) {
      if (!isValidRequest) {
        console.warn('[Discord] PING signature verification failed');
        return res.status(401).json({ error: 'Invalid request signature' });
      }
      console.log('[Discord] Responding to PING');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"type":1}');
    }

    // For non-PING requests, verify signature is valid
    if (!isValidRequest) {
      console.warn('[Discord] Signature verification failed for non-PING');
      return res.status(401).json({ error: 'Invalid request signature' });
    }

    // Handle application commands (type 2) - delegate to Express router
    if (interaction.type === 2) {
      // Import and use the Express router handler
      const { default: handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
      const response = await handleCommand(interaction);
      return res.status(200).json(response);
    }

    // Unknown interaction type
    return res.status(400).json({ error: 'Unknown interaction type' });

  } catch (error) {
    console.error('[Discord] Critical error:', error);
    // If error occurs, check if it might be a PING request
    try {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
      if (bodyStr && bodyStr.includes('"type":1')) {
        console.log('[Discord] Error occurred but responding with PONG for potential PING');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"type":1}');
      }
    } catch (e) {
      // Ignore
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
}

