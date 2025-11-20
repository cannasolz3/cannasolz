/**
 * Discord interactions endpoint - STANDALONE serverless function
 * Completely bypasses Express to avoid any middleware interference
 * 
 * CRITICAL: Discord verification requires:
 * 1. Response to PING with {"type":1}
 * 2. No CORS headers
 * 3. Response within 3 seconds
 * 4. Proper Content-Type header
 */

export default async function handler(req, res) {
  // Only POST
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end('{"error":"Method not allowed"}');
  }

  try {
    // Get body - Vercel parses JSON automatically
    const body = req.body || {};
    
    // CRITICAL: Handle PING immediately - Discord verification requires this
    // Must respond with exact format: {"type":1}
    if (body.type === 1) {
      // Use writeHead to ensure minimal headers - no Express interference
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"type":1}');
    }

    // For non-PING requests, return error (commands handled by Express router)
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end('{"error":"Unknown interaction type"}');
    
  } catch (error) {
    // Fallback: if anything fails, try to respond with PONG
    // This ensures Discord verification always gets a response
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
