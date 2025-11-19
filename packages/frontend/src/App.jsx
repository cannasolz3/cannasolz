import { useMemo, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { Toaster, toast } from 'react-hot-toast';
import { ChevronDownIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import HolderVerification from './components/HolderVerification.jsx';
import UserProfile from './components/UserProfile.jsx';
import SocialLinks from './components/SocialLinks.jsx';
import { UserProvider, useUser } from './contexts/UserContext.jsx';
import { SOLANA_RPC_URL, API_BASE_URL } from './config.js';
import { projectName, projectDescription, projectConfig } from './config/projectConfig.js';
import './theme.css';

const network = WalletAdapterNetwork.Mainnet;

function UserMenu() {
  const { discordUser, handleLogout } = useUser();
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [pendingWalletAdd, setPendingWalletAdd] = useState(false);

  if (!discordUser) return null;

  const avatarUrl = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.discord_id}/${discordUser.avatar}.png`
    : null;

  const csBalance = discordUser?.token_balance ?? '0.00';

  // Fetch linked wallets when dropdown opens
  useEffect(() => {
    if (open && discordUser) {
      fetchWallets();
    }
  }, [open, discordUser]);

  const fetchWallets = async () => {
    setLoadingWallets(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/wallets`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (response.ok) {
        const data = await response.json();
        // Ensure wallets are in object format
        const formattedWallets = (data.wallets || []).map(w => 
          typeof w === 'string' ? { wallet_address: w } : w
        );
        setWallets(formattedWallets);
      }
    } catch (error) {
      console.error('Error fetching wallets:', error);
    } finally {
      setLoadingWallets(false);
    }
  };

  const handleAddWallet = () => {
    setPendingWalletAdd(true);
    setVisible(true);
  };

  // Auto-add wallet when connected after clicking "Add New Wallet"
  useEffect(() => {
    const addWalletIfPending = async () => {
      if (pendingWalletAdd && connected && publicKey) {
        // Refresh wallets list first to get latest
        await fetchWallets();
        
        // Check if already linked
        const isAlreadyLinked = wallets.some(w => {
          const addr = typeof w === 'string' ? w : (w?.wallet_address || w);
          return addr === publicKey.toString();
        });
        
        if (!isAlreadyLinked) {
          try {
            const response = await fetch(`${API_BASE_URL}/api/user/wallets`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ wallet_address: publicKey.toString() })
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.success) {
                toast.success('Wallet added successfully!');
                setPendingWalletAdd(false);
                fetchWallets(); // Refresh wallet list
                // Refresh page to update holdings
                setTimeout(() => window.location.reload(), 1000);
              }
            }
          } catch (error) {
            console.error('Error adding wallet:', error);
            setPendingWalletAdd(false);
          }
        } else {
          setPendingWalletAdd(false);
        }
      }
    };

    addWalletIfPending();
  }, [pendingWalletAdd, connected, publicKey, wallets]);

  const formatWalletAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const isWalletConnected = (walletAddress) => {
    return connected && publicKey && publicKey.toString() === walletAddress;
  };

  return (
    <div className="user-menu">
      <button className="user-menu-trigger" onClick={() => setOpen(!open)}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={discordUser.discord_username} className="user-avatar" />
        ) : (
          <div className="user-avatar placeholder">{discordUser.discord_username?.[0] || 'U'}</div>
        )}
        <span className="user-name">{discordUser.discord_username}</span>
        <ChevronDownIcon className={`chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <div className="dropdown-item balance">
            <span>$CSz420</span>
            <strong>{csBalance}</strong>
          </div>
          
          {/* Linked Wallets Section */}
          <div className="dropdown-section">
            <div className="dropdown-section-header">Linked Wallets</div>
            {loadingWallets ? (
              <div className="dropdown-item">Loading...</div>
            ) : wallets.length === 0 ? (
              <div className="dropdown-item text-gray-400 text-sm">No wallets linked</div>
            ) : (
              wallets.map((wallet) => {
                // Handle both string and object formats
                const walletAddress = typeof wallet === 'string' ? wallet : wallet.wallet_address;
                if (!walletAddress) return null;
                
                const isConnected = isWalletConnected(walletAddress);
                return (
                  <div key={walletAddress} className="dropdown-item wallet-item">
                    <div className="flex items-center justify-between w-full">
                      <span className="text-sm font-mono">{formatWalletAddress(walletAddress)}</span>
                      {isConnected ? (
                        <CheckIcon className="w-4 h-4 text-green-400" />
                      ) : (
                        <XMarkIcon className="w-4 h-4 text-gray-500" />
                      )}
                    </div>
                  </div>
                );
              }).filter(Boolean)
            )}
            <button 
              className="dropdown-item add-wallet" 
              onClick={handleAddWallet}
            >
              + Add New Wallet
            </button>
          </div>

          <div className="dropdown-divider"></div>
          
          <button className="dropdown-item logout" onClick={handleLogout}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function Home() {
  const [isVerifyOpen, setIsVerifyOpen] = useState(false);
  const { discordUser } = useUser();
  const { connected } = useWallet();
  const heroEyebrow = `${projectName} Holder Portal [POWERED BY BUXDAO]`;
  const heroTitle = projectConfig.hero?.title || 'Verify, view your holdings and rewards';
  const heroCopy = projectConfig.hero?.lede || projectDescription || 'Holder verification, Discord roles, live sales bot, and rewards claims.';
  const heroThumbnail = projectConfig.hero?.thumbnailUrl || 'https://img-cdn.magiceden.dev/rs:fill:400:0:0/plain/https%3A%2F%2Fcreator-hub-prod.s3.us-east-2.amazonaws.com%2Fcannasolz_pfp_1668579712636.png';
  const isDiscordConnected = Boolean(discordUser);
  const walletLinked = Boolean(discordUser?.wallet_address || connected);

  const shouldShowCta = !isDiscordConnected || !walletLinked;
  let ctaLabel = 'Holder Verification';
  if (isDiscordConnected && !walletLinked) {
    ctaLabel = 'Connect Wallet';
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="hero-media">
          <img src={heroThumbnail} alt={`${projectName} thumbnail`} />
        </div>
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-main">{projectName} Holder Portal</span>
            <span className="eyebrow-powered">[POWERED BY BUXDAO]</span>
          </p>
          <h1>{heroTitle}</h1>
          <div className="hero-lede-row">
            <p className="lede">{heroCopy}</p>
            {shouldShowCta ? (
              <button className="primary-cta" onClick={() => setIsVerifyOpen(true)}>
                {ctaLabel}
              </button>
            ) : (
              <UserMenu />
            )}
          </div>
          <SocialLinks />
        </div>
      </header>
      <main className="app-grid single">
        <section className="panel container-panel">
          <UserProfile />
        </section>
      </main>
      {isVerifyOpen && (
        <div className="modal-overlay" onClick={() => setIsVerifyOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Holder Verification</h3>
              <button className="modal-close" onClick={() => setIsVerifyOpen(false)} aria-label="Close verification modal">
                ×
              </button>
            </div>
            <HolderVerification />
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <BrowserRouter>
      <ConnectionProvider endpoint={SOLANA_RPC_URL} config={{ commitment: 'processed' }} network={network}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <UserProvider>
              <Routes>
                <Route path="/*" element={<Home />} />
              </Routes>
              <Toaster position="bottom-center" gutter={8} toastOptions={{ duration: 4000 }} />
            </UserProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </BrowserRouter>
  );
}
