import React, { useState, useEffect } from 'react';
import { useUser } from '../contexts/UserContext';
import { useWallet } from '@solana/wallet-adapter-react';
import { API_BASE_URL, TOKEN_SYMBOL } from '../config';
import { toast } from 'react-hot-toast';
import { Connection, Transaction } from '@solana/web3.js';
import BuxClaimButton from './BuxClaimButton';
import { DiscordIcon } from './Icons';

const NFT_PLACEHOLDER = 'https://img-cdn.magiceden.dev/rs:fill:400:0:0/plain/https%3A%2F%2Fcreator-hub-prod.s3.us-east-2.amazonaws.com%2Fcannasolz_pfp_1668579712636.png';


const UserProfile = () => {
  const { discordUser } = useUser();
  const wallet = useWallet();
  const [userData, setUserData] = useState({
    wallet_address: discordUser?.wallet_address || '',
    balance: 0,
    unclaimed_rewards: 0,
    primaryCollection: { name: 'CannaSolz', count: 0, dailyYield: 0 },
    nfts: [],
    roles: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [claimAmount, setClaimAmount] = useState('');
  const [timeUntilUpdate, setTimeUntilUpdate] = useState(0);
  const [isClaimLoading, setIsClaimLoading] = useState(false);
  const [showCnfts, setShowCnfts] = useState(false); // Toggle between NFTs and cNFTs

  // Format time remaining
  const formatTimeRemaining = (milliseconds) => {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Calculate time until next update
  useEffect(() => {
    const calculateTimeUntilUpdate = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.getTime() - now.getTime();
    };

    const updateTimer = () => {
      const timeLeft = calculateTimeUntilUpdate();
      setTimeUntilUpdate(timeLeft);

      // If timer reaches 0, trigger rewards update
      if (timeLeft <= 0 && discordUser?.discord_id) {
        handleRewardsUpdate();
      }
    };

    // Initial calculation
    updateTimer();

    // Update every second
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [discordUser]);

  // Handle rewards update
  const handleRewardsUpdate = async () => {
    if (!discordUser?.discord_id) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/rewards/process-daily`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to process rewards:', error);
        return;
      }

      // Refresh user data after rewards are processed
      await fetchUserData();
      toast.success('Daily rewards have been processed!');
    } catch (error) {
      console.error('Error processing rewards:', error);
    }
  };

  // Listen for rewards processed event
  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE_URL}/api/rewards/events`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'rewards_processed') {
        fetchUserData();
        toast.success(`Daily rewards processed: ${data.total_rewards} ${TOKEN_SYMBOL} distributed!`);
      }
    };

    return () => eventSource.close();
  }, []);

  useEffect(() => {
    const fetchUserData = async () => {
      if (!discordUser?.discord_id) {
        setIsLoading(false);
        return;
      }
      
      try {
        // Fetch collection counts and claim account data
        const [holdingsResponse, claimAccountResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/user/holdings`, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Origin': window.location.origin,
              'Content-Type': 'application/json'
            }
          }),
          fetch(`${API_BASE_URL}/api/user/claim`, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Origin': window.location.origin
            }
          })
        ]);

        if (holdingsResponse.ok) {
          const holdingsData = await holdingsResponse.json();
          setUserData(prev => ({
            ...prev,
            primaryCollection: {
              name: holdingsData.collection?.name || 'CannaSolz',
              count: holdingsData.collection?.count || 0,
              dailyYield: holdingsData.collection?.daily_yield || 0
            },
            nfts: holdingsData.nfts || [],
            counts: holdingsData.counts || {},
            dailyYields: holdingsData.daily_yields || {}
          }));
        } else {
          console.error('Failed to fetch holdings:', await holdingsResponse.text());
        }

        const claimData = await claimAccountResponse.json();
        setUserData(prev => ({
          ...prev,
          balance: claimData.balance || 0,
          unclaimed_rewards: claimData.unclaimed_amount || 0
        }));

        // Now fetch roles
        const rolesResponse = await fetch(`${API_BASE_URL}/api/auth/roles`, {
          credentials: 'include',
          headers: { 
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Origin': window.location.origin
          }
        });

        if (!rolesResponse.ok) {
          console.error('Failed to fetch roles:', await rolesResponse.text());
        } else {
          const rolesData = await rolesResponse.json();
          console.log('Roles data:', rolesData);

          // Update state with roles
          setUserData(prev => ({
            ...prev,
            roles: rolesData.roles || []
          }));
        }
      } catch (error) {
        console.error('Failed to fetch user data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [discordUser]);

  // Listen for balance updates
  useEffect(() => {
    const handleBalanceUpdate = (event) => {
      setUserData(prev => ({
        ...prev,
        balance: parseFloat(event.detail.newBalance),
        unclaimed_rewards: parseFloat(event.detail.unclaimedAmount)
      }));
    };

    window.addEventListener('bux:balanceUpdated', handleBalanceUpdate);
    return () => window.removeEventListener('bux:balanceUpdated', handleBalanceUpdate);
  }, []);


  const handleClaimRewards = async () => {
    if (!wallet.connected) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!claimAmount || claimAmount <= 0) {
      toast.error('Please enter a valid amount to claim');
      return;
    }

    if (claimAmount > userData.unclaimed_rewards) {
      toast.error('Insufficient unclaimed balance');
      return;
    }

    setIsClaimLoading(true);
    try {
      // Start claim process
      const claimResponse = await fetch(`${API_BASE_URL}/api/user/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ amount: parseInt(claimAmount) })
      });

      if (!claimResponse.ok) {
        const error = await claimResponse.json();
        toast.error(error.error || 'Failed to initiate claim');
        return;
      }

      const { transaction: serializedTx, txId } = await claimResponse.json();

      // Request wallet signature
      try {
        const tx = Transaction.from(Buffer.from(serializedTx, 'base64'));
        
        // Sign transaction
        const signedTx = await wallet.signTransaction(tx);
        if (!signedTx) {
          throw new Error('Failed to sign transaction');
        }

        // Send transaction
        const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
        const signature = await connection.sendRawTransaction(
          signedTx.serialize()
        );

        // Wait for confirmation
        toast.loading('Confirming transaction...', { id: 'confirm-tx' });
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
          throw new Error('Transaction failed');
        }

        // Confirm with backend
        const confirmResponse = await fetch(`${API_BASE_URL}/api/user/claim/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ txId, signature })
        });

        if (!confirmResponse.ok) {
          const error = await confirmResponse.json();
          toast.error(error.error || 'Failed to confirm claim');
          return;
        }

        // Success! Update UI
        setUserData(prev => ({
          ...prev,
          unclaimed_rewards: prev.unclaimed_rewards - parseInt(claimAmount),
          balance: prev.balance + parseInt(claimAmount)
        }));

        toast.success('Successfully claimed rewards!');
        setClaimAmount(''); // Reset input
        toast.dismiss('confirm-tx');

      } catch (error) {
        console.error('Transaction error:', error);
        toast.error(error.message || 'Failed to process transaction');
        toast.dismiss('confirm-tx');
      }

    } catch (error) {
      console.error('Claim error:', error);
      toast.error('Failed to process claim');
    } finally {
      setIsClaimLoading(false);
    }
  };

    // Add handlers for max and 50% buttons
  const handleMaxClaim = () => {
    setClaimAmount(userData?.unclaimed_rewards || 0);
  };

  const handle50Claim = () => {
    setClaimAmount((userData?.unclaimed_rewards || 0) / 2);
  };

  if (isLoading) {
    return (
      <div className="rounded-lg bg-gradient-to-br from-fuchsia-600 via-violet-600 to-blue-600 p-8 mx-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-white/20 rounded w-3/4 mx-auto"></div>
          <div className="h-4 bg-white/20 rounded w-1/2 mx-auto"></div>
          <div className="h-4 bg-white/20 rounded w-5/6 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-6xl font-bold text-purple-400 text-center">My CannaSolz</h2>
      <div className="p-8 space-y-8 userprofile-wrap">
        {/* Top Row Grid - NFTs and Roles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* NFT Holdings */}
          <div className="tile bg-gradient-to-br from-gray-900/90 to-gray-800/90 rounded-lg p-6 shadow-lg backdrop-blur-sm border border-fuchsia-500/20">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm4 1.5l3 3 2-2 4 4 2-2.5" />
                </svg>
                My {showCnfts ? 'cNFTs' : 'NFTs'}
              </h3>
              {/* Toggle Switch */}
              <div className="flex items-center gap-2">
                <span className={`text-sm ${!showCnfts ? 'text-white' : 'text-gray-500'}`}>NFTs</span>
                <button
                  onClick={() => setShowCnfts(!showCnfts)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    showCnfts ? 'bg-purple-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      showCnfts ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className={`text-sm ${showCnfts ? 'text-white' : 'text-gray-500'}`}>cNFTs</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-fuchsia-500/30">
                    <th className="py-2 text-fuchsia-300">Colour</th>
                    <th className="py-2 text-fuchsia-300 text-center">Count</th>
                    <th className="py-2 text-fuchsia-300 text-center">
                      <div>Daily Yield</div>
                      <div className="text-xs opacity-80">($CSz420)</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    if (showCnfts) {
                      // Display cNFTs
                      const cnftCounts = userData.cnftCounts || {};
                      const cnftDailyYields = userData.cnftDailyYields || {};
                      
                      const rows = [
                        { key: 'gold', label: 'Gold', count: cnftCounts.gold || 0, yield: cnftDailyYields.gold || 0 },
                        { key: 'silver', label: 'Silver', count: cnftCounts.silver || 0, yield: cnftDailyYields.silver || 0 },
                        { key: 'purple', label: 'Purple', count: cnftCounts.purple || 0, yield: cnftDailyYields.purple || 0 },
                        { key: 'dark_green', label: 'Dark green', count: cnftCounts.dark_green || 0, yield: cnftDailyYields.dark_green || 0 },
                        { key: 'light_green', label: 'Light green', count: cnftCounts.light_green || 0, yield: cnftDailyYields.light_green || 0 }
                      ];
                      
                      const totalCount = cnftCounts.total || rows.reduce((sum, row) => sum + row.count, 0);
                      const totalYield = cnftDailyYields.total || rows.reduce((sum, row) => sum + row.yield, 0);
                      
                      return (
                        <>
                          {rows.map((row) => (
                            <tr key={row.key}>
                              <td className="py-3">{row.label}</td>
                              <td className="py-3 text-center">{row.count}</td>
                              <td className="py-3 text-center">
                                {row.yield > 0 ? Number(row.yield).toFixed(2) : '—'}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-fuchsia-500/30">
                            <td className="py-3 font-semibold">Total</td>
                            <td className="py-3 text-center font-semibold">{totalCount}</td>
                            <td className="py-3 text-center font-semibold">{Number(totalYield).toFixed(2)}</td>
                          </tr>
                        </>
                      );
                    } else {
                      // Display regular NFTs
                      const counts = userData.counts || {};
                      const dailyYields = userData.dailyYields || {};
                      
                      // Define row order with OG420 first
                      const rows = [
                        { key: 'og420', label: 'OG420', count: counts.og420 || 0, yield: dailyYields.og420 || 0 },
                        { key: 'gold', label: 'Gold', count: counts.gold || 0, yield: dailyYields.gold || 0 },
                        { key: 'silver', label: 'Silver', count: counts.silver || 0, yield: dailyYields.silver || 0 },
                        { key: 'purple', label: 'Purple', count: counts.purple || 0, yield: dailyYields.purple || 0 },
                        { key: 'dark_green', label: 'Dark green', count: counts.dark_green || 0, yield: dailyYields.dark_green || 0 },
                        { key: 'light_green', label: 'Light green', count: counts.light_green || 0, yield: dailyYields.light_green || 0 }
                      ];
                      
                      const totalCount = counts.total || rows.reduce((sum, row) => sum + row.count, 0);
                      const totalYield = dailyYields.total || userData.primaryCollection.dailyYield || 0;
                      
                      return (
                        <>
                          {rows.map((row) => (
                            <tr key={row.key}>
                              <td className="py-3">{row.label}</td>
                              <td className="py-3 text-center">{row.count}</td>
                              <td className="py-3 text-center">
                                {row.yield > 0 ? Number(row.yield).toFixed(2) : '—'}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-fuchsia-500/30">
                            <td className="py-3 font-semibold">Total</td>
                            <td className="py-3 text-center font-semibold">{totalCount}</td>
                            <td className="py-3 text-center font-semibold">{Number(totalYield).toFixed(2)}</td>
                          </tr>
                        </>
                      );
                    }
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Roles Display */}
          <div className="tile bg-gradient-to-br from-gray-900/90 to-gray-800/90 rounded-lg p-6 shadow-lg backdrop-blur-sm border border-fuchsia-500/20">
            <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <DiscordIcon className="w-6 h-6 text-white" />
              My Roles
            </h3>
            <div className="flex flex-wrap gap-2">
              {(!userData?.roles || userData.roles.length === 0) && (
                <div className="text-gray-400 text-sm">
                  <p>Please connect your wallet and verify in Discord</p>
                  <p className="mt-1 text-xs">This will sync your roles and holdings.</p>
                </div>
              )}
              {userData?.roles?.map((role, index) => (
                <div 
                  key={role.id || index} 
                  className="inline-flex items-center rounded px-2 py-1 bg-gray-800/80 hover:bg-gray-800 transition-colors"
                >
                  <div 
                    className="w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: role.color }}
                  />
                  {role.emoji_url && (
                    <img 
                      src={role.emoji_url}
                      alt=""
                      className="w-4 h-4 mr-1"
                    />
                  )}
                  <span className="text-sm font-medium text-white">
                    {role.display_name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Claim Section */}
        {/* Bottom Claim Section */}
        <div className="tile bg-gradient-to-br from-gray-900/90 to-gray-800/90 rounded-lg p-6 shadow-lg backdrop-blur-sm border border-fuchsia-500/20">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-6 h-6" fill="white" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <path d="M 21 4 C 19.207031 4 17.582031 4.335938 16.3125 4.96875 C 15.042969 5.601563 14 6.632813 14 8 L 14 12 C 14 12.128906 14.042969 12.253906 14.0625 12.375 C 13.132813 12.132813 12.101563 12 11 12 C 9.207031 12 7.582031 12.335938 6.3125 12.96875 C 5.042969 13.601563 4 14.632813 4 16 L 4 24 C 4 25.367188 5.042969 26.398438 6.3125 27.03125 C 7.582031 27.664063 9.207031 28 11 28 C 12.792969 28 14.417969 27.664063 15.6875 27.03125 C 16.957031 26.398438 18 25.367188 18 24 L 18 23.59375 C 18.917969 23.835938 19.921875 24 21 24 C 22.792969 24 24.417969 23.664063 25.6875 23.03125 C 26.957031 22.398438 28 21.367188 28 20 L 28 8 C 28 6.632813 26.957031 5.601563 25.6875 4.96875 C 24.417969 4.335938 22.792969 4 21 4 Z" />
            </svg>
            Claim Rewards
          </h3>
          <div className="mb-6">
            <p className="text-fuchsia-300 mb-2">Unclaimed Balance</p>
            <p className="text-2xl font-bold text-white mb-3">
              {Number(userData?.unclaimed_rewards || 0).toFixed(2)} $CSz420
            </p>
            <div className="space-y-3">
              <div className="relative">
                <input
                  type="number"
                  value={claimAmount}
                  onChange={(e) => setClaimAmount(e.target.value)}
                  placeholder="0"
                  className="w-full p-2 border-2 border-white/20 rounded-lg bg-gray-900/50 \n                           text-white placeholder-gray-400 focus:outline-none \n                           focus:border-white/40 shadow-inner disabled:opacity-50"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-2">
                  <button 
                    onClick={handle50Claim}
                    className="px-2 py-1 text-xs bg-gray-800 text-white rounded hover:bg-gray-700 \n                             disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    50%
                  </button>
                  <button 
                    onClick={handleMaxClaim}
                    className="px-2 py-1 text-xs bg-gray-800 text-white rounded hover:bg-gray-700\n                             disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    MAX
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-4">
                <p className="text-fuchsia-300">Rewards update in:</p>
                <div className="bg-gray-900 px-3 py-1 rounded font-mono text-lg text-white">
                  {formatTimeRemaining(timeUntilUpdate)}
                </div>
              </div>
              <div className="relative">
                <BuxClaimButton
                  amount={parseInt(claimAmount)}
                  onError={(error) => toast.error(error.message || 'Claim failed')}
                  className="w-full py-3 px-4 rounded-lg font-bold border-2 border-white/90 \n                            relative overflow-hidden transition-all duration-300\n                            disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#c0c0c0,#e0c0f5,#c0c0c0)]" />
                  <div className="relative z-10 text-white uppercase tracking-[0.15em] font-black \n                                [text-shadow:_-1px_-1px_0_#000,_1px_-1px_0_#000,_-1px_1px_0_#000,_1px_1px_0_#000]">
                    CLAIM
                  </div>
                </BuxClaimButton>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default UserProfile; 