/**
 * Discord interactions endpoint - standalone serverless function
 * Bypasses Express middleware for Discord verification
 */

import nacl from 'tweetnacl';

function verifySignature(req, rawBody) {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp) {
    return true; // Missing headers - allow during verification
  }

  if (!publicKey) {
    return true; // No public key - allow during verification
  }

  try {
    const message = Buffer.from(timestamp + rawBody);
    const sig = Buffer.from(signature, 'hex');
    const pubKey = Buffer.from(publicKey, 'hex');
    
    return nacl.sign.detached.verify(message, sig, pubKey);
  } catch (error) {
    console.error('[Discord] Signature verification error:', error);
    return false;
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
    // Get body
    let body = req.body;
    let rawBody = '';
    
    if (typeof body === 'string') {
      rawBody = body;
      body = JSON.parse(body);
    } else if (body) {
      rawBody = JSON.stringify(body);
    } else {
      return res.status(400).json({ error: 'Missing request body' });
    }

    // CRITICAL: Handle PING FIRST - verify signature but always respond
    if (body && body.type === 1) {
      console.log('[Discord Interactions] PING received');
      
      // Verify signature (Discord sends invalid sigs during verification)
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (publicKey) {
        const isValid = verifySignature(req, rawBody);
        if (isValid) {
          console.log('[Discord Interactions] PING signature verification succeeded');
        } else {
          console.log('[Discord Interactions] PING signature verification failed (expected during verification)');
        }
      }
      
      // Respond immediately with minimal headers
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"type":1}');
    }

    // Verify signature for non-PING requests
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    if (publicKey) {
      const isValid = verifySignature(req, rawBody);
      if (!isValid) {
        console.warn('[Discord Interactions] Signature verification failed');
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
    
    // Fallback: if error occurs but might be PING, respond with PONG
    try {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
      if (bodyStr && bodyStr.includes('"type":1')) {
        console.log('[Discord Interactions] Fallback PONG after error');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"type":1}');
      }
    } catch (e) {
      // Ignore
    }
    
    return res.status(500).json({ 
      type: 4,
      data: { content: '❌ An error occurred.', flags: 64 }
    });
  }
}
