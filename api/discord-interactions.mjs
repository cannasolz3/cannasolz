/**
 * Standalone Discord interactions endpoint for Vercel
 * Handles PING/PONG for verification and slash commands
 */

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Read raw body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    
    // Parse JSON
    let interaction;
    try {
      interaction = JSON.parse(rawBody);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Handle PING immediately - Discord verification
    if (interaction.type === 1) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).end('{"type":1}');
    }

    // For other interaction types, import and use the full handler
    const { handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
    const response = await handleCommand(interaction);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('Discord interaction error:', error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ 
      type: 4,
      data: { content: '❌ An error occurred.', flags: 64 }
    });
  }
}

