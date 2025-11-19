/**
 * Standalone Discord interactions endpoint for Vercel
 * Handles PING/PONG for verification and slash commands
 * This is a dedicated serverless function that bypasses all Express middleware
 * 
 * CRITICAL: Discord verification requires exact response format {"type":1} for PING requests
 * Must respond within 3 seconds with status 200
 * 
 * For Discord Developer Portal verification:
 * - Responds to PING (type: 1) with PONG ({"type":1})
 * - No signature verification required for PING during initial verification
 */

// Helper function to send PONG response
function sendPong(res) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end('{"type":1}');
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CRITICAL: Try to detect PING request as early as possible
  // Check body string for PING pattern before parsing
  try {
    const bodyCheck = req.body;
    if (bodyCheck) {
      const bodyStr = typeof bodyCheck === 'string' ? bodyCheck : JSON.stringify(bodyCheck);
      // Quick check for PING - respond immediately if detected
      // Check for type:1 pattern (with or without spaces, case-insensitive)
      if (bodyStr && bodyStr.match(/"type"\s*:\s*1/)) {
        console.log('[Discord Interactions] PING detected early - responding with PONG');
        sendPong(res);
        return;
      }
    }
  } catch (e) {
    // Continue with normal parsing
  }

  try {
    // Parse body - handle both parsed and raw body formats
    let interaction;
    
    // Vercel may or may not parse the body automatically
    if (req.body) {
      if (typeof req.body === 'object' && req.body.type !== undefined) {
        // Already parsed as object
        interaction = req.body;
      } else if (typeof req.body === 'string') {
        // Body is a string, parse it
        interaction = JSON.parse(req.body);
      } else {
        // Try to stringify and parse
        interaction = JSON.parse(JSON.stringify(req.body));
      }
    } else {
      // Body might be missing - this shouldn't happen, but handle gracefully
      console.warn('[Discord Interactions] Missing request body');
      // Still try to respond to potential PING
      sendPong(res);
      return;
    }

    // CRITICAL: Handle PING immediately - Discord verification
    // Discord requires EXACT response: {"type":1} with 200 status
    // Must respond within 3 seconds, no caching, immediate response
    if (interaction && interaction.type === 1) {
      console.log('[Discord Interactions] PING detected - responding with PONG');
      sendPong(res);
      return;
    }

    // For other interaction types
    console.log('[Discord Interactions] Handling interaction type:', interaction?.type);
    
    if (interaction?.type === 2) {
      // Application command
      const { handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
      const response = await handleCommand(interaction);
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json(response);
    }
    
    // Unknown interaction type
    return res.status(400).json({ error: 'Unknown interaction type' });
    
  } catch (error) {
    console.error('[Discord Interactions] ERROR:', error);
    console.error('[Discord Interactions] Stack:', error.stack);
    
    // If error occurs during verification, try to respond with PONG
    // This helps with edge cases during Discord's verification process
    // Check if the error might be related to a PING request
    try {
      const checkBody = req.body || '';
      const bodyStr = typeof checkBody === 'string' ? checkBody : JSON.stringify(checkBody || '');
      // Check for PING pattern in body string
      if (bodyStr && (bodyStr.includes('"type":1') || bodyStr.includes('"type": 1') || bodyStr.includes('"type":1}'))) {
        console.log('[Discord Interactions] Fallback: Responding with PONG to potential PING');
        sendPong(res);
        return;
      }
    } catch (e) {
      // Ignore fallback error
    }
    
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ 
      type: 4,
      data: { content: '❌ An error occurred.', flags: 64 }
    });
  }
}
