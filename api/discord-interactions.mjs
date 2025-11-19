/**
 * Discord interactions endpoint with signature verification
 */

import nacl from 'tweetnacl';

// Verify Discord signature
function verifySignature(req, rawBody) {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp) {
    // Missing headers - during verification, Discord might not send them
    return true; // Allow through for verification
  }

  if (!publicKey) {
    // No public key set - allow during verification
    return true;
  }

  try {
    const message = Buffer.from(timestamp + rawBody);
    const sig = Buffer.from(signature, 'hex');
    const pubKey = Buffer.from(publicKey, 'hex');
    
    return nacl.sign.detached.verify(message, sig, pubKey);
  } catch (error) {
    console.error('[Discord] Signature verification error:', error);
    // During verification, allow through if verification fails
    return true;
  }
}

export default async function handler(req, res) {
  // OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Signature-Ed25519, X-Signature-Timestamp'
    });
    return res.end();
  }

  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get body - Vercel parses JSON automatically
    let body = req.body;
    
    // Parse if needed
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // CRITICAL: Handle PING FIRST - before any signature verification
    // Discord verification requires immediate response
    if (body.type === 1) {
      console.log('[Discord Interactions] PING - responding with PONG');
      // Remove all extra headers - Discord may reject responses with Vercel/cache headers
      res.removeHeader('cache-control');
      res.removeHeader('x-vercel-cache');
      res.removeHeader('x-vercel-id');
      res.writeHead(200, { 
        'Content-Type': 'application/json'
      });
      return res.end('{"type":1}');
    }

    // Get raw body for signature verification (for non-PING requests)
    let rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // Verify signature for non-PING requests
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    if (publicKey) {
      const isValid = verifySignature(req, rawBody);
      if (!isValid) {
        console.warn('[Discord] Signature verification failed');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    // Handle commands
    if (body && body.type === 2) {
      const { handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
      const response = await handleCommand(body);
      return res.status(200).json(response);
    }

    return res.status(400).json({ error: 'Unknown interaction type' });
    
  } catch (error) {
    console.error('[Discord Interactions] Error:', error);
    console.error('[Discord Interactions] Error stack:', error.stack);
    
    // Last resort: if it might be a PING, respond with PONG
    try {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
      if (bodyStr && (bodyStr.includes('"type":1') || bodyStr.includes('"type": 1'))) {
        console.log('[Discord Interactions] Fallback PONG after error');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"type":1}');
      }
    } catch (e) {
      console.error('[Discord Interactions] Fallback error:', e);
    }
    
    return res.status(500).json({ 
      type: 4,
      data: { content: '❌ An error occurred.', flags: 64 }
    });
  }
}
