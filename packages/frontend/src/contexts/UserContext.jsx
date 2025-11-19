import React, { createContext, useContext, useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { API_BASE_URL } from '../config';

const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const { publicKey, connected, disconnect } = useWallet();
  const [discordUser, setDiscordUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const checkAuth = async () => {
    if (initialized) return;
    
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/check`, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        },
        cache: 'no-store'
      });

      const data = await response.json();
      
      if (data.authenticated && data.user) {
        // Fetch roles
        const rolesPromise = fetch(`${API_BASE_URL}/api/auth/roles`, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        }).then(r => r.ok ? r.json() : { roles: [] }).catch(() => ({ roles: [] }));
        // Fetch token balance from balance endpoint
        const claimPromise = fetch(`${API_BASE_URL}/api/user/balance`, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
        const [rolesData, claimData] = await Promise.all([rolesPromise, claimPromise]);
          setDiscordUser({
            ...data.user,
          roles: rolesData.roles || [],
          discord_roles: rolesData.roles || [],
          token_balance: Number(claimData.balance || 0).toFixed(2)
          });
      } else {
        setDiscordUser(null);
      }
    } catch (error) {
      console.error('Auth check error:', error);
      setDiscordUser(null);
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Auto-link wallet on connect (only if not already linked)
  useEffect(() => {
    if (connected && publicKey && discordUser && discordUser.discord_id) {
      // Check if wallet is already linked before adding
      fetch(`${API_BASE_URL}/api/user/wallets`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
      .then(r => r.ok ? r.json() : { wallets: [] })
      .then(data => {
        const wallets = data.wallets || [];
        const isAlreadyLinked = wallets.some(w => {
          const addr = typeof w === 'string' ? w : w.wallet_address;
          return addr === publicKey.toString();
        });
        
        if (!isAlreadyLinked) {
          // Auto-link if not already linked
          fetch(`${API_BASE_URL}/api/user/wallets`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet_address: publicKey.toString() })
          }).catch(err => console.error('Auto-link error:', err));
        }
      })
      .catch(err => console.error('Error checking wallets:', err));
    }
  }, [connected, publicKey, discordUser]);

  const handleLogout = async () => {
    try {
      setDiscordUser(null);
      setInitialized(false);

      if (connected) {
        await disconnect();
      }

      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });

      localStorage.clear();
      sessionStorage.clear();
      
      document.cookie.split(';').forEach(cookie => {
        const name = cookie.split('=')[0].trim();
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      });

      window.location.replace('/?clear=' + Date.now());
    } catch (error) {
      console.error('Logout error:', error);
      window.location.replace('/?clear=' + Date.now());
    }
  };

  const value = {
    discordUser,
    setDiscordUser,
    loading,
    handleLogout,
    walletConnected: connected,
    walletAddress: publicKey?.toString(),
    checkAuth
  };

  if (!initialized && loading) {
    return null;
  }

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}; 