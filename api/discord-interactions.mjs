/**
 * Standalone Discord interactions endpoint for Vercel
 * Handles PING/PONG for verification and slash commands
 * This is a dedicated serverless function that bypasses all Express middleware
 */

export default async function handler(req, res) {
  console.log('[Discord Interactions] === REQUEST START ===');
  console.log('[Discord Interactions] Method:', req.method);
  console.log('[Discord Interactions] URL:', req.url);
  console.log('[Discord Interactions] Headers:', JSON.stringify(req.headers));
  
  // Only allow POST
  if (req.method !== 'POST') {
    console.log('[Discord Interactions] Method not allowed');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get body - handle multiple formats
    let interaction;
    
    // Check if body is already parsed (Express might have done this)
    if (req.body && typeof req.body === 'object' && 'type' in req.body) {
      interaction = req.body;
      console.log('[Discord Interactions] Using req.body, type:', interaction.type);
    } else {
      // Read raw body
      let rawBody = '';
      if (typeof req.body === 'string') {
        rawBody = req.body;
      } else if (Buffer.isBuffer(req.body)) {
        rawBody = req.body.toString('utf8');
      } else {
        // Read from request stream
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        await new Promise((resolve) => {
          req.on('end', resolve);
          req.on('error', resolve);
        });
        rawBody = Buffer.concat(chunks).toString('utf8');
      }
      
      console.log('[Discord Interactions] Raw body:', rawBody);
      interaction = JSON.parse(rawBody);
    }

    console.log('[Discord Interactions] Interaction type:', interaction.type);

    // CRITICAL: Handle PING immediately - Discord verification
    // Discord requires EXACT response: {"type":1} with 200 status
    // Must respond within 3 seconds, no caching, immediate response
    if (interaction.type === 1) {
      console.log('[Discord Interactions] PING detected - responding with PONG');
      // Set all headers at once - no caching, correct content type
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end('{"type":1}');
      console.log('[Discord Interactions] PONG sent');
      return;
    }

    // For other interaction types
    console.log('[Discord Interactions] Handling command:', interaction.data?.name);
    const { handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
    const response = await handleCommand(interaction);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('[Discord Interactions] ERROR:', error);
    console.error('[Discord Interactions] Stack:', error.stack);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ 
      type: 4,
      data: { content: '❌ An error occurred.', flags: 64 }
    });
  }
}
