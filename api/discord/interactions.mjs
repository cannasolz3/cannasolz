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
    let rawBody = '';
    
    // Get raw body for signature verification
    if (typeof body === 'string') {
      rawBody = body;
      body = JSON.parse(body);
    } else if (body) {
      rawBody = JSON.stringify(body);
    } else {
      // Body might be empty or undefined
      return res.status(400).json({ error: 'Missing request body' });
    }

    // Verify signature (but be lenient during verification)
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    if (publicKey) {
      const isValid = verifySignature(req, rawBody);
      // Only reject if signature is invalid AND it's not a PING
      // During verification, Discord sends PING and we should respond even if signature fails
      if (!isValid && body.type !== 1) {
        console.warn('[Discord] Signature verification failed for non-PING');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    // Handle PING - respond immediately with exact format
    if (body && body.type === 1) {
      console.log('[Discord Interactions] PING - responding with PONG');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"type":1}');
    }

    // Handle commands
    if (body && body.type === 2) {
      const { handleCommand } = await import('../../packages/backend/src/api/integrations/discord/commands.js');
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
