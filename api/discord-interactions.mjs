/**
 * Discord interactions endpoint - standalone serverless function
 */

import nacl from 'tweetnacl';

function verifySignature(req, rawBody) {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp) {
    return true;
  }

  if (!publicKey) {
    return true;
  }

  try {
    const message = Buffer.from(timestamp + rawBody);
    const sig = Buffer.from(signature, 'hex');
    const pubKey = Buffer.from(publicKey, 'hex');
    
    return nacl.sign.detached.verify(message, sig, pubKey);
  } catch (error) {
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

  // Handle GET requests
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok"}');
  }

  // Only POST
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end('{"error":"Method not allowed"}');
  }

  try {
    // Get body - Vercel parses JSON automatically
    let body = req.body;
    let rawBody = '';
    
    if (typeof body === 'string') {
      rawBody = body;
      body = JSON.parse(body);
    } else if (body) {
      rawBody = JSON.stringify(body);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end('{"error":"Missing request body"}');
    }

    // CRITICAL: Handle PING FIRST
    if (body && body.type === 1) {
      // Verify signature silently
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (publicKey) {
        verifySignature(req, rawBody);
      }
      // Respond immediately
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"type":1}');
      return;
    }

    // Verify signature for non-PING requests
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    if (publicKey) {
      const isValid = verifySignature(req, rawBody);
      if (!isValid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end('{"error":"Unauthorized"}');
      }
    }

    // Handle commands
    if (body && body.type === 2) {
      const { handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
      const response = await handleCommand(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(response));
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end('{"error":"Unknown interaction type"}');
    
  } catch (error) {
    // Fallback: if error occurs but might be PING, respond with PONG
    try {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
      if (bodyStr && bodyStr.includes('"type":1')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"type":1}');
        return;
      }
    } catch (e) {
      // Ignore
    }
    
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ 
      type: 4,
      data: { content: '❌ An error occurred.', flags: 64 }
    }));
  }
}
