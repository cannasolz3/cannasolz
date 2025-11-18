import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { API_BASE_URL, TOKEN_SYMBOL } from '../config.js';

const BuxClaimButton = ({ 
  amount, 
  onSuccess, 
  onError,
  disabled,
  className,
  children,
  unclaimedAmount = 0
}) => {
  const wallet = useWallet();
  const { publicKey, signTransaction, connected } = wallet;
  const connection = useConnection();
  const { setVisible } = useWalletModal();
  const [isLoading, setIsLoading] = useState(false);
  const pendingClaimRef = useRef(false);

  const processClaim = useCallback(async () => {
    if (!publicKey || !signTransaction) {
      return;
    }

    setIsLoading(true);
    try {

      const response = await fetch(`${API_BASE_URL}/api/user/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          walletAddress: publicKey.toString(),
          amount
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process claim');
      }

      const responseData = await response.json();
      const { transaction: serializedTx } = responseData;

      if (!serializedTx) {
        throw new Error('No transaction received from backend');
      }

      console.log('Deserializing transaction...');
      const tx = Transaction.from(Buffer.from(serializedTx, 'base64'));
      
      // Ensure transaction has recent blockhash for wallet display
      if (!tx.recentBlockhash) {
        const { blockhash } = await connection.connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
      }
      
      // Ensure fee payer is set
      if (!tx.feePayer) {
        tx.feePayer = publicKey;
      }
      
      console.log('Requesting wallet signature...', {
        instructions: tx.instructions.length,
        signatures: tx.signatures.length,
        feePayer: tx.feePayer?.toString(),
        recentBlockhash: tx.recentBlockhash,
        walletConnected: connected,
        publicKey: publicKey?.toString(),
        walletReady: wallet.ready,
        adapterName: wallet.adapter?.name
      });
      
      // Ensure wallet adapter is ready
      if (!wallet.ready || !wallet.adapter) {
        throw new Error('Wallet is not ready. Please try again.');
      }
      
      // Request signature from wallet - this should open the wallet prompt
      console.log('Calling signTransaction - wallet should prompt now...');
      const signedTx = await signTransaction(tx);
      if (!signedTx) {
        throw new Error('Failed to sign transaction - wallet did not return signed transaction');
      }
      console.log('Transaction signed by wallet successfully');

      const finalizeResponse = await fetch(`${API_BASE_URL}/api/user/claim/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          signedTransaction: signedTx.serialize().toString('base64'),
          walletAddress: publicKey.toString(),
          amount
        })
      });

      if (!finalizeResponse.ok) {
        const error = await finalizeResponse.json();
        throw new Error(error.error || 'Failed to finalize claim');
      }

      const finalizeResult = await finalizeResponse.json();
      if (finalizeResult.success) {
        onSuccess?.(finalizeResult);
        window.dispatchEvent(new CustomEvent('bux:balanceUpdated', {
          detail: {
            newBalance: finalizeResult.newBalance,
            unclaimedAmount: finalizeResult.unclaimedAmount
          }
        }));
      } else {
        throw new Error('Claim finalization failed');
      }
    } catch (error) {
      console.error('Claim error:', error);
      onError?.(error instanceof Error ? error : new Error('Unknown claim error'));
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, signTransaction, amount, onSuccess, onError, connection, wallet]);

  // If wallet gets connected after we opened the modal, proceed with claim
  useEffect(() => {
    console.log('Wallet connection state changed:', {
      connected,
      hasPublicKey: !!publicKey,
      hasSignTransaction: !!signTransaction,
      pendingClaim: pendingClaimRef.current,
      amount,
      walletReady: wallet.ready,
      adapterName: wallet.adapter?.name
    });

    if (connected && publicKey && signTransaction && pendingClaimRef.current && amount > 0) {
      console.log('All conditions met, setting up claim timer...');
      // Wait a moment for wallet to be fully ready
      const timer = setTimeout(() => {
        console.log('Timer fired, proceeding with claim...');
        pendingClaimRef.current = false;
        processClaim();
      }, 1000); // Increased delay to 1 second
      
      return () => {
        console.log('Cleaning up claim timer');
        clearTimeout(timer);
      };
    }
  }, [connected, publicKey, signTransaction, amount, processClaim, wallet]);

  const handleClaim = async () => {
    console.log('Claim button clicked:', {
      connected,
      hasPublicKey: !!publicKey,
      hasSignTransaction: !!signTransaction,
      amount,
      unclaimedAmount
    });

    // If wallet is not connected, prompt user to connect
    if (!connected || !publicKey || !signTransaction) {
      console.log('Wallet not connected, opening wallet modal and setting pending claim flag');
      pendingClaimRef.current = true;
      setVisible(true);
      return;
    }

    console.log('Wallet already connected, proceeding directly with claim');
    processClaim();
  };

  // Enable button if Discord is connected (unclaimedAmount > 0) and amount > 0
  // Wallet connection will be prompted on click if not connected
  const isEnabled = !disabled && amount > 0 && unclaimedAmount > 0 && !isLoading;

  return (
    <button
      onClick={handleClaim}
      disabled={!isEnabled}
      className={className}
    >
      {children || (isLoading ? 'Claiming...' : `Claim ${TOKEN_SYMBOL}`)}
    </button>
  );
};

export default BuxClaimButton;
