import expressPkg from 'express';
import holdings from './holdings.js';
import claim from './claim.js';
import wallets from './wallets.js';
import balance from './balance.js';

const router = expressPkg.Router();

router.use('/holdings', holdings);
router.use('/claim', claim);
router.use('/wallets', wallets);
router.use('/balance', balance);

export default router; 