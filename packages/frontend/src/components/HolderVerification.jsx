import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useLocation } from 'react-router-dom';
import { DiscordIcon } from './Icons';
import { useUser } from '../contexts/UserContext';
import { toast } from 'react-hot-toast';
import { API_BASE_URL } from '../config';

// Helper function to generate random state
function generateState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

const HolderVerification = () => {
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { discordUser, setDiscordUser } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [verificationStatus, setVerificationStatus] = useState('pending');
  const location = useLocation();

  const API_BASE = API_BASE_URL;

  // Handle Discord OAuth callback
  useEffect(() => {
    const handleCallback = async () => {
      const searchParams = new URLSearchParams(location.search);
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');

      if (error) {
        setError('Failed to connect with Discord. Please try again.');
        return;
      }

      if (code) {
        setLoading(true);
        try {
          window.location.href = `${API_BASE}/api/auth/discord/callback?code=${code}&state=${state}`;
        } catch (err) {
          setError('Failed to authenticate with Discord. Please try again.');
        } finally {
          setLoading(false);
        }
      }
    };

    handleCallback();
  }, [location]);

  // Update verification status when discord user changes
  useEffect(() => {
    if (discordUser?.wallet_address) {
      setVerificationStatus('verified');
    }
  }, [discordUser]);

  const handleDiscordLogin = () => {
    try {
      const state = crypto.getRandomValues(new Uint8Array(16))
        .reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
      
      document.cookie = `discord_state=${state}; path=/; max-age=300; secure; samesite=lax`;
      window.location.href = `${API_BASE}/api/auth/discord?state=${state}`;
    } catch (error) {
      setError('Failed to start Discord authentication');
    }
  };

  const handleConnectWallet = async () => {
    if (!connected) {
      setVisible(true);
    }
  };

  // Handle wallet verification when connected - allow multiple wallets
  useEffect(() => {
    const verifyWallet = async () => {
      if (!connected || !publicKey || !discordUser) {
        return;
      }

      // Check if this wallet is already linked
      try {
        const checkResponse = await fetch(`${API_BASE}/api/user/wallets`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        
        if (checkResponse.ok) {
          const walletsData = await checkResponse.json();
          const wallets = walletsData.wallets || [];
          const isAlreadyLinked = wallets.some(w => w.wallet_address === publicKey.toString());
          
          if (isAlreadyLinked) {
            // Wallet already linked, don't verify again
            return;
          }
        }
      } catch (err) {
        console.error('Error checking wallets:', err);
      }

      try {
        setLoading(true);
        // Use POST /api/user/wallets to add wallet (supports multiple wallets)
        const response = await fetch(`${API_BASE}/api/user/wallets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            wallet_address: publicKey.toString()
          })
        });

        if (!response.ok) {
          throw new Error('Failed to connect wallet');
        }

        const data = await response.json();
        if (data.success) {
          toast.success('Wallet connected successfully!');
          // Set verified status if this is the first wallet
          if (!discordUser?.wallet_address) {
            setVerificationStatus('verified');
          }
          // Refresh user data to show updated holdings from all wallets
          if (setDiscordUser) {
            // Trigger a refresh of user data
            window.location.reload();
          }
        }
      } catch (error) {
        console.error('Wallet connection error:', error);
        toast.error('Failed to connect wallet. Please try again.');
        setError(error.message);
      } finally {
        setLoading(false);
      }
    };

    verifyWallet();
  }, [connected, publicKey, discordUser]);

  return (
    <div className="verification-modal-content">
      <div className="modal-card">
        {/* Discord Connection */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-300 mb-4 flex items-center gap-2">
            Step 1: Connect Discord
            {discordUser && <span className="text-green-400">✓</span>}
          </h3>
          {discordUser ? (
            <div className="flex items-center justify-between bg-gray-800 p-4 rounded-lg">
              <div className="flex items-center space-x-4">
                {discordUser.avatar && (
                  <img
                    src={`https://cdn.discordapp.com/avatars/${discordUser.discord_id}/${discordUser.avatar}.png`}
                    alt={discordUser.discord_username}
                    className="w-10 h-10 rounded-full"
                  />
                )}
                <div>
                  <p className="text-white font-medium">{discordUser.discord_display_name || discordUser.discord_username}</p>
                  <p className="text-green-400 text-sm">Connected</p>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={handleDiscordLogin}
              disabled={loading}
              className="flex items-center justify-center space-x-3 bg-[#5865F2] px-8 py-3 rounded-full text-white text-base sm:text-lg hover:opacity-90 transition-opacity border-2 border-white shadow-[0_0_15px_rgba(0,0,0,0.5)] whitespace-nowrap w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <DiscordIcon className="h-5 w-5 sm:h-6 sm:w-6" />
              <span>{loading ? 'Connecting...' : 'Login with Discord'}</span>
            </button>
          )}
        </div>

        {/* Wallet Connection */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-300 mb-4 flex items-center gap-2">
            Step 2: Connect Wallet{discordUser?.wallet_address && <span className="text-green-400 text-sm ml-2">(You can connect multiple wallets)</span>}
            {connected && <span className="text-green-400">✓</span>}
          </h3>
          {connected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-gray-800 p-4 rounded-lg">
                <div>
                  <p className="text-white font-medium">{publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)}</p>
                  <p className="text-green-400 text-sm">Connected</p>
                </div>
                <button
                  onClick={disconnect}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Disconnect
                </button>
              </div>
              <button
                onClick={handleConnectWallet}
                disabled={!discordUser || loading}
                className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {loading ? 'Connecting...' : 'Connect Another Wallet'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectWallet}
              disabled={!discordUser}
              className="w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!discordUser ? 'Connect Discord First' : 'Connect Wallet'}
            </button>
          )}
        </div>

        {/* Verification Status */}
        {error && (
          <p className="mt-4 text-sm">
            {verificationStatus === 'verified' ? (
              <span className="text-green-400">
                Successfully verified. You can view your full server role list in profile.
              </span>
            ) : (
              <span className="text-red-500">{error}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
};

export default HolderVerification; 