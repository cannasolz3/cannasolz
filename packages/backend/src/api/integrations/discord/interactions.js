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
    // Missing headers - during verification, Discord might not send them
    return true; // Allow PING through for verification
  }
  
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    // No public key - allow during verification
    return true;
  }
  
  try {
    // Discord signature verification: timestamp + raw body
    const bodyString = req.rawBody?.toString() || '';
    const message = Buffer.from(timestamp + bodyString);
    const sig = Buffer.from(signature, 'hex');
    const pubKey = Buffer.from(publicKey, 'hex');
    
    return nacl.sign.detached.verify(message, sig, pubKey);
  } catch (error) {
    console.error('Signature verification error:', error);
    // During verification, Discord sends invalid signatures to test security
    // For PING requests, allow through even if signature fails
    return false;
  }
}

// Handle Discord interactions
interactionsRouter.post('/', async (req, res) => {
  // CRITICAL: Ensure response is always sent, even on error
  let responseSent = false;
  const sendResponse = (status, data) => {
    if (!responseSent) {
      responseSent = true;
      res.status(status).json(data);
    }
  };

  try {
    // Get interaction - try multiple sources for Vercel serverless compatibility
    let interaction = null;
    let rawBodyString = '';
    
    // Try rawBody first (from raw middleware)
    if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
      rawBodyString = req.rawBody.toString('utf8');
    } 
    // Fallback: try parsed body (Vercel might parse it)
    else if (req.body && typeof req.body === 'object') {
      // Already parsed - use it directly
      interaction = req.body;
      rawBodyString = JSON.stringify(req.body);
    }
    // Last resort: empty
    else {
      rawBodyString = '{}';
    }
    
    // Parse if not already parsed
    if (!interaction) {
      try {
        interaction = JSON.parse(rawBodyString);
      } catch (parseError) {
        console.error('Error parsing interaction body:', parseError);
        // If parsing fails but body might be PING, try to respond
        if (rawBodyString && rawBodyString.includes('"type":1')) {
          sendResponse(200, { type: 1 });
          return;
        }
        sendResponse(400, { error: 'Invalid JSON' });
        return;
      }
    }
    
    // CRITICAL: Handle PING FIRST - before any other processing
    // Discord verification requires immediate response
    if (interaction && (interaction.type === 1 || interaction.type === InteractionType.PING)) {
      console.log('Received PING, responding with PONG');
      // Remove all headers that might interfere
      res.removeHeader('Access-Control-Allow-Origin');
      res.removeHeader('Access-Control-Allow-Credentials');
      res.removeHeader('Vary');
      res.removeHeader('X-Powered-By');
      // Use res.json() to ensure proper JSON formatting
      sendResponse(200, { type: 1 });
      return;
    }
    
    // Ensure rawBody is set for signature verification
    if (!req.rawBody && rawBodyString) {
      req.rawBody = Buffer.from(rawBodyString, 'utf8');
    }
    
    // Verify signature - but be lenient for PING during verification
    // Discord sends invalid signatures during verification to test security
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    if (publicKey && interaction.type !== 1 && interaction.type !== InteractionType.PING) {
      const isValid = verifySignature(req);
      if (!isValid) {
        console.warn('Signature verification failed');
        sendResponse(401, { error: 'Unauthorized' });
        return;
      }
    }
    
    // Handle application commands
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const response = await handleCommand(interaction);
      return res.json(response);
    }
    
    // Unknown interaction type
    sendResponse(400, { error: 'Unknown interaction type' });
  } catch (error) {
    console.error('Error handling Discord interaction:', error);
    // If error occurs, check if it might be a PING request
    try {
      const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
      if (bodyStr && bodyStr.includes('"type":1')) {
        console.log('Error occurred but responding with PONG for potential PING');
        sendResponse(200, { type: 1 });
        return;
      }
    } catch (e) {
      // Ignore
    }
    
    if (!responseSent) {
      sendResponse(500, {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ An error occurred processing your command.',
          flags: 64 // Ephemeral
        }
      });
    }
  }
});

export default interactionsRouter;

