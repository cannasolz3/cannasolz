/**
 * Standalone Discord interactions endpoint for Vercel
 * Handles PING/PONG for verification and slash commands
 */

export default async function handler(req, res) {
  console.log('[Discord Interactions] Request received:', req.method, req.url);
  
  // Only allow POST
  if (req.method !== 'POST') {
    console.log('[Discord Interactions] Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Read raw body - Vercel provides it as a stream or buffer
    let rawBody = '';
    
    if (req.body) {
      // Body might already be parsed or available
      if (typeof req.body === 'string') {
        rawBody = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        rawBody = req.body.toString('utf8');
      } else {
        // Already parsed JSON
        const interaction = req.body;
        console.log('[Discord Interactions] Body already parsed, type:', interaction.type);
        
        // Handle PING immediately - Discord verification
        if (interaction.type === 1) {
          console.log('[Discord Interactions] PING detected, responding with PONG');
          res.setHeader('Content-Type', 'application/json');
          return res.status(200).end('{"type":1}');
        }
        
        // Handle other interaction types
        const { handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
        const response = await handleCommand(interaction);
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(response);
      }
    } else {
      // Read from stream
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      rawBody = Buffer.concat(chunks).toString('utf8');
    }
    
    console.log('[Discord Interactions] Raw body length:', rawBody.length);
    
    // Parse JSON
    let interaction;
    try {
      interaction = JSON.parse(rawBody);
      console.log('[Discord Interactions] Parsed interaction type:', interaction.type);
    } catch (e) {
      console.error('[Discord Interactions] JSON parse error:', e);
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Handle PING immediately - Discord verification
    if (interaction.type === 1) {
      console.log('[Discord Interactions] PING detected, responding with PONG');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).end('{"type":1}');
    }

    // For other interaction types, import and use the full handler
    const { handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
    const response = await handleCommand(interaction);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('[Discord Interactions] Error:', error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ 
      type: 4,
      data: { content: '❌ An error occurred.', flags: 64 }
    });
  }
}

