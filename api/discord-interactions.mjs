/**
 * Standalone Discord interactions endpoint for Vercel
 * Handles PING/PONG for verification and slash commands
 * 
 * CRITICAL: Discord verification requires exact response format {"type":1} for PING requests
 * Must respond within 3 seconds with status 200
 */

export default async function handler(req, res) {
  // Handle OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Signature-Ed25519, X-Signature-Timestamp'
    });
    return res.end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get interaction - Vercel parses JSON automatically
    let interaction = req.body;
    
    // Handle case where body might be a string
    if (typeof interaction === 'string') {
      interaction = JSON.parse(interaction);
    }
    
    // Ensure we have an object
    if (!interaction || typeof interaction !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // CRITICAL: Handle PING immediately - Discord verification
    // Discord requires EXACT response: {"type":1} with 200 status
    if (interaction.type === 1) {
      console.log('[Discord Interactions] PING - responding with PONG');
      // Use exact string format - no spaces in JSON
      res.status(200).setHeader('Content-Type', 'application/json');
      return res.end('{"type":1}');
    }

    // Handle application commands
    if (interaction.type === 2) {
      const { handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
      const response = await handleCommand(interaction);
      return res.status(200).json(response);
    }
    
    // Unknown interaction type
    return res.status(400).json({ error: 'Unknown interaction type' });
    
  } catch (error) {
    console.error('[Discord Interactions] ERROR:', error);
    
    // If error occurs, check if it might be a PING request
    try {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
      if (bodyStr && bodyStr.includes('"type":1')) {
        console.log('[Discord Interactions] Fallback PONG');
        res.status(200).setHeader('Content-Type', 'application/json');
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
