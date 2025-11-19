/**
 * Discord interactions endpoint - minimal implementation
 */

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
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Handle PING - respond immediately
    if (body.type === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"type":1}');
    }

    // Handle commands
    if (body.type === 2) {
      const { handleCommand } = await import('../packages/backend/src/api/integrations/discord/commands.js');
      const response = await handleCommand(body);
      return res.status(200).json(response);
    }

    return res.status(400).json({ error: 'Unknown interaction type' });
    
  } catch (error) {
    console.error('[Discord Interactions] Error:', error);
    return res.status(500).json({ 
      type: 4,
      data: { content: '❌ An error occurred.', flags: 64 }
    });
  }
}
