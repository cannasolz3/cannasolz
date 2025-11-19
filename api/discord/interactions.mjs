/**
 * Discord interactions endpoint - absolute minimal implementation
 * Responds to PING with exact format Discord expects
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

  // Handle PING - respond immediately with exact format
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  
  if (body && body.type === 1) {
    // Discord requires exactly {"type":1} - no extra whitespace, no formatting
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"type":1}');
  }

  // Handle commands
  if (body && body.type === 2) {
    try {
      const { handleCommand } = await import('../../packages/backend/src/api/integrations/discord/commands.js');
      const response = await handleCommand(body);
      return res.status(200).json(response);
    } catch (error) {
      console.error('Command error:', error);
      return res.status(500).json({ 
        type: 4,
        data: { content: '❌ An error occurred.', flags: 64 }
      });
    }
  }

  return res.status(400).json({ error: 'Unknown interaction type' });
}
