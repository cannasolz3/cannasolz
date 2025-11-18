import { useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { Toaster } from 'react-hot-toast';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import HolderVerification from './components/HolderVerification.jsx';
import UserProfile from './components/UserProfile.jsx';
import SocialLinks from './components/SocialLinks.jsx';
import { UserProvider, useUser } from './contexts/UserContext.jsx';
import { SOLANA_RPC_URL } from './config.js';
import { projectName, projectDescription, projectConfig } from './config/projectConfig.js';
import './theme.css';

const network = WalletAdapterNetwork.Mainnet;

function UserMenu() {
  const { discordUser, handleLogout } = useUser();
  const [open, setOpen] = useState(false);

  if (!discordUser) return null;

  const avatarUrl = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.discord_id}/${discordUser.avatar}.png`
    : null;

  const csBalance = discordUser?.token_balance ?? '0.00';

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
