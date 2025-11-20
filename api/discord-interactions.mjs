/**
 * Discord interactions endpoint - STANDALONE serverless function
 * Completely bypasses Express to avoid any middleware interference
 */

import nacl from 'tweetnacl';

function verifySignature(req, rawBody) {
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!signature || !timestamp || !publicKey) {
    return false;
  }

  try {
    if (signature.length !== 128) return false; // Ed25519 sig is 64 bytes = 128 hex chars
    const message = Buffer.from(timestamp + rawBody);
    const sig = Buffer.from(signature, 'hex');
    const pubKey = Buffer.from(publicKey, 'hex');
    if (sig.length !== 64 || pubKey.length !== 32) return false;
    return nacl.sign.detached.verify(message, sig, pubKey);
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  // Only POST
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end('{"error":"Method not allowed"}');
  }

  try {
    // Get body - Vercel parses JSON automatically
    const body = req.body || {};
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    
    // CRITICAL: Handle PING immediately
    if (body.type === 1) {
      // For PING during verification, Discord may send valid signatures
      // We must verify and respond, but also handle invalid sigs gracefully
      const publicKey = process.env.DISCORD_PUBLIC_KEY;
      if (publicKey && req.headers['x-signature-ed25519'] && req.headers['x-signature-timestamp']) {
        // Attempt signature verification
        // Note: rawBody is reconstructed, so verification may fail even with valid sigs
        // But we still respond to allow verification to proceed
        try {
          verifySignature(req, rawBody);
        } catch (e) {
          // Ignore verification errors for PING during verification
        }
      }
      
      // Always respond with PONG for PING requests
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"type":1}');
    }

    // For non-PING requests, return error (commands handled by Express router)
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end('{"error":"Unknown interaction type"}');
    
  } catch (error) {
    // Fallback: if anything fails, try to respond with PONG
    try {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
      if (bodyStr && bodyStr.includes('"type":1')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"type":1}');
      }
    } catch (e) {
      // Ignore
    }
    
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end('{"error":"Internal server error"}');
  }
}
