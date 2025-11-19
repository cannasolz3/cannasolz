import expressPkg from 'express';
import nacl from 'tweetnacl';
import { handleCommand } from './commands.js';

// Discord interaction types
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5
};

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9
};

const interactionsRouter = expressPkg.Router();

// Handle OPTIONS requests (CORS preflight)
interactionsRouter.options('/', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Signature-Ed25519, X-Signature-Timestamp');
  res.status(200).end();
});

// Middleware to capture raw body BEFORE any parsing
interactionsRouter.use(expressPkg.raw({ 
  type: 'application/json',
  limit: '1mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Verify Discord request signature
function verifySignature(req) {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  
  if (!signature || !timestamp) {
    console.warn('Missing signature headers');
    return false;
  }
  
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    console.warn('DISCORD_PUBLIC_KEY not set, skipping signature verification');
    // In production, we should require the key, but allow in dev for testing
    return process.env.NODE_ENV !== 'production';
  }
  
  try {
    // Discord signature verification: timestamp + raw body
    const bodyString = req.rawBody?.toString() || '';
    const message = Buffer.from(timestamp + bodyString);
    const sig = Buffer.from(signature, 'hex');
    const pubKey = Buffer.from(publicKey, 'hex');
    
    const isValid = nacl.sign.detached.verify(message, sig, pubKey);
    if (!isValid) {
      console.warn('Signature verification failed');
    }
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

// Handle Discord interactions
interactionsRouter.post('/', async (req, res) => {
  try {
    // Get raw body - must be Buffer from raw middleware
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      console.error('No rawBody available');
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    const rawBodyString = req.rawBody.toString('utf8');
    
    // Parse interaction
    let interaction;
    try {
      interaction = JSON.parse(rawBodyString);
    } catch (parseError) {
      console.error('Error parsing interaction body:', parseError);
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    
    // Handle ping (Discord verification) - CRITICAL: respond immediately with exact format
    // Discord sends PING for endpoint verification - must respond within 3 seconds
    if (interaction.type === 1 || interaction.type === InteractionType.PING) {
      console.log('Received PING, responding with PONG');
      // Discord requires EXACT response: {"type": 1} 
      // No extra whitespace, no formatting - exact string
      res.setHeader('Content-Type', 'application/json');
      res.status(200).end('{"type":1}');
      return;
    }
    
    // Verify signature for all other interaction types
    // Skip verification in development if key not set
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    if (publicKey && process.env.NODE_ENV === 'production') {
      if (!verifySignature(req)) {
        console.warn('Invalid signature or missing headers');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    } else if (!publicKey) {
      console.warn('DISCORD_PUBLIC_KEY not set - signature verification disabled');
    }
    
    // Handle application commands
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const response = await handleCommand(interaction);
      return res.json(response);
    }
    
    // Unknown interaction type
    return res.status(400).json({ error: 'Unknown interaction type' });
  } catch (error) {
    console.error('Error handling Discord interaction:', error);
    return res.status(500).json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ An error occurred processing your command.',
        flags: 64 // Ephemeral
      }
    });
  }
});

export default interactionsRouter;

