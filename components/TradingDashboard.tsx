"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTrading, TradingConfig, TradingSession } from '@/lib/hooks/useTrading';
import { useIntegratedWallet } from '@/lib/wallet/IntegratedWalletContext';
import { NavigationHeader } from './NavigationHeader';
import { LoadingSkeleton, CardSkeleton } from './ui/loading-skeleton';
import { useToast } from './ui/toast';
import { BaseAccountTradingOptions } from './BaseAccountTradingOptions';
import { BaseAccountTradingPanel } from './BaseAccountTradingPanel';
import { useBaseMiniApp } from '@/lib/hooks/useBaseMiniApp';

export function TradingDashboard() {
  const { startTrading, stopTrading, getTradingSessions, isLoading, error } = useTrading();
  const { totalPortfolioValue, isConnected, primaryWallet, avantisBalance, isAvantisConnected, hasRealAvantisBalance, isLoading: walletLoading } = useIntegratedWallet();
  const { addToast } = useToast();
  const { isBaseContext } = useBaseMiniApp();
  
  const [sessions, setSessions] = useState<TradingSession[]>([]);
  const [showStartForm, setShowStartForm] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [config, setConfig] = useState<TradingConfig>({
    totalBudget: 100,
    profitGoal: 20,
    maxPositions: 3,
    leverage: 5
  });

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const userSessions = await getTradingSessions();
      setSessions(userSessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      addToast({
        type: 'error',
        title: 'Failed to load trading sessions',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } finally {
      setIsLoadingSessions(false);
    }
  }, [getTradingSessions, addToast]);

  // Load trading sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const validateBalance = (budget: number): boolean => {
    if (!isConnected) {
      setBalanceError('Wallet not connected. Please connect your wallet first.');
      return false;
    }

    // Removed Avantis connection check since addresses are the same

    if (budget < 10) {
      setBalanceError('Minimum investment amount is $10');
      return false;
    }

    if (budget > 1000) {
      setBalanceError('Maximum investment amount is $1000 per session');
      return false;
    }

    if (avantisBalance === 0) {
      setBalanceError('Insufficient balance. Your trading balance is $0.00. Please add funds to start trading.');
      return false;
    }

    if (budget > avantisBalance) {
      setBalanceError(`Insufficient balance. You're trying to invest $${budget.toFixed(2)} but your trading balance is only $${avantisBalance.toFixed(2)}.`);
      return false;
    }

    setBalanceError(null);
    return true;
  };

  const handleStartTrading = useCallback(async () => {
    // Clear previous balance error
    setBalanceError(null);

    // Validate balance before starting
    if (!validateBalance(config.totalBudget)) {
      return;
    }

    try {
      const newSession = await startTrading(config);
      setSessions((prev: TradingSession[]) => [newSession, ...prev]);
      setShowStartForm(false);
      
      // Show success toast
      addToast({
        type: 'success',
        title: 'Trading session started',
        message: `Trading session with $${config.totalBudget} budget and $${config.profitGoal} profit goal has been started successfully.`
      });
      
      // Reset form
      setConfig({
        totalBudget: 100,
        profitGoal: 20,
        maxPositions: 3,
        leverage: 5
      });
    } catch (error) {
      console.error('Failed to start trading:', error);
      addToast({
        type: 'error',
        title: 'Failed to start trading',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  }, [config, startTrading, addToast]);

  const handleStopTrading = async (sessionId: string) => {
    try {
      await stopTrading(sessionId);
      await loadSessions(); // Reload sessions to get updated status
    } catch (error) {
      console.error('Failed to stop trading:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-green-500';
      case 'completed': return 'text-blue-500';
      case 'stopped': return 'text-yellow-500';
      case 'error': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      <NavigationHeader
        title="Trading Dashboard"
        showBackButton={true}
        backHref="/home"
        breadcrumbs={[
          { label: 'Home', href: '/home' },
          { label: 'Trading Dashboard' }
        ]}
        actions={
                 <Button
                   onClick={() => setShowStartForm(true)}
                   disabled={isLoading || !isConnected || avantisBalance === 0}
                   className="bg-[#8759ff] hover:bg-[#7c4dff] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                   {!isConnected ? 'Connect Wallet First' :
                    avantisBalance === 0 ? 'Add Funds to Start Trading' :
                    'Start Trading Session'}
                 </Button>
        }
      />

      <div className="px-4 sm:px-6 space-y-6 max-w-md mx-auto py-6">
        {/* Base Account Trading Options */}
        {isBaseContext && (
          <>
            <BaseAccountTradingOptions
              onFallbackWalletCreated={() => {
                addToast({
                  type: 'success',
                  title: 'Fallback wallet created',
                  message: 'You can now use automated trading strategies with the fallback wallet.'
                });
              }}
            />
            {/* Base Account Manual Trading Panel */}
            {sessions.length > 0 && sessions[0]?.status === 'running' && (
              <BaseAccountTradingPanel
                sessionId={sessions[0].id}
                onPositionOpened={() => {
                  loadSessions();
                  // Toast is already shown in BaseAccountTradingPanel, no need to duplicate
                }}
                onPositionClosed={() => {
                  loadSessions();
                  // Toast is already shown in BaseAccountTradingPanel, no need to duplicate
                }}
              />
            )}
          </>
        )}

               {/* Simplified wallet status - no complex connection guides needed */}
               {walletLoading ? (
                 <CardSkeleton />
               ) : isConnected && primaryWallet ? (
                 <Card className="p-4 bg-[#1a1a1a] border-[#333]">
                   <div className="flex items-center justify-between">
                     <div>
                       <h3 className="text-lg font-semibold text-white">Trading Wallet Ready</h3>
                       <p className="text-sm text-gray-400">
                         Your wallet is ready for trading. Balance: <span className="font-medium text-white">${avantisBalance.toFixed(2)}</span>
                       </p>
                     </div>
                     <div className="text-right">
                       <div className="text-sm text-gray-400">Address:</div>
                       <div className="text-xs font-mono text-gray-300">
                         {primaryWallet.address.slice(0, 6)}...{primaryWallet.address.slice(-4)}
                       </div>
                     </div>
                   </div>
                 </Card>
               ) : null}

      {/* Wallet Balance Display */}
      <Card className="p-4 bg-[#1a1a1a] border-[#333]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Wallet Status</h3>
                     <p className="text-sm text-gray-400">
                       {isConnected ? 'Connected' : 'Not Connected'} •
                       Trading Balance: <span className="font-medium text-white">${avantisBalance.toFixed(2)}</span>
                     </p>
          </div>
          {!isConnected && (
            <Button 
              onClick={() => window.location.href = '/home'}
              className="bg-[#8759ff] hover:bg-[#7c4dff] text-white"
            >
              Connect Wallet
            </Button>
          )}
        </div>
      </Card>

      {/* Error Display */}
      {(error || balanceError) && (
        <Card className="p-4 bg-red-900/20 border-red-500">
          <p className="text-red-400">Error: {error || balanceError}</p>
        </Card>
      )}

      {/* Start Trading Form */}
      {showStartForm && (
        <Card className="p-6 bg-[#1a1a1a] border-[#333]">
          <h3 className="text-xl font-semibold text-white mb-4">Start New Trading Session</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Total Budget (USD)
              </label>
              <Input
                type="number"
                value={config.totalBudget}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const value = parseFloat(e.target.value) || 0;
                  setConfig((prev: TradingConfig) => ({ ...prev, totalBudget: value }));
                  // Clear balance error when user changes the value
                  if (balanceError) setBalanceError(null);
                }}
                className={`bg-[#2a2a2a] border-[#444] text-white ${
                  config.totalBudget > avantisBalance ? 'border-red-500' : ''
                }`}
                placeholder="100"
              />
              {config.totalBudget > avantisBalance && avantisBalance > 0 && (
                <p className="text-xs text-red-400 mt-1">
                  Exceeds trading balance by ${(config.totalBudget - avantisBalance).toFixed(2)}
                </p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Profit Goal (USD)
              </label>
              <Input
                type="number"
                value={config.profitGoal}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig((prev: TradingConfig) => ({ ...prev, profitGoal: parseFloat(e.target.value) || 0 }))}
                className="bg-[#2a2a2a] border-[#444] text-white"
                placeholder="20"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Max Positions
              </label>
              <Input
                type="number"
                value={config.maxPositions}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig((prev: TradingConfig) => ({ ...prev, maxPositions: parseInt(e.target.value) || 1 }))}
                className="bg-[#2a2a2a] border-[#444] text-white"
                placeholder="3"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Leverage
              </label>
              <Input
                type="number"
                value={config.leverage}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig((prev: TradingConfig) => ({ ...prev, leverage: parseFloat(e.target.value) || 10 }))}
                className="bg-[#2a2a2a] border-[#444] text-white"
                placeholder="5"
              />
            </div>
          </div>

          <div className="flex gap-3">
                   <Button
                     onClick={handleStartTrading}
                     disabled={isLoading || !isConnected || avantisBalance === 0 || config.totalBudget > avantisBalance || config.totalBudget < 10}
                     className="bg-[#8759ff] hover:bg-[#7c4dff] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                     {isLoading ? 'Starting...' : 'Start Trading'}
                   </Button>
            <Button 
              onClick={() => setShowStartForm(false)}
              variant="outline"
              className="border-[#444] text-gray-300 hover:bg-[#2a2a2a]"
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Trading Sessions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold text-white">Trading Sessions</h3>
          <Button
            onClick={loadSessions}
            variant="outline"
            size="sm"
            className="border-[#444] text-gray-300 hover:bg-[#2a2a2a] text-xs"
            disabled={isLoadingSessions}
          >
            {isLoadingSessions ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
        </div>
        
        {isLoadingSessions ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="p-6 bg-[#1a1a1a] border-[#333] animate-pulse">
                <div className="flex justify-between items-start mb-4">
                  <div className="space-y-2">
                    <div className="h-6 bg-gray-700 rounded w-32"></div>
                    <div className="h-4 bg-gray-700 rounded w-24"></div>
                  </div>
                  <div className="h-8 bg-gray-700 rounded w-16"></div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <div className="h-3 bg-gray-700 rounded w-16"></div>
                    <div className="h-6 bg-gray-700 rounded w-20"></div>
                  </div>
                  <div className="space-y-1">
                    <div className="h-3 bg-gray-700 rounded w-20"></div>
                    <div className="h-6 bg-gray-700 rounded w-16"></div>
                  </div>
                  <div className="space-y-1">
                    <div className="h-3 bg-gray-700 rounded w-24"></div>
                    <div className="h-6 bg-gray-700 rounded w-18"></div>
                  </div>
                  <div className="space-y-1">
                    <div className="h-3 bg-gray-700 rounded w-20"></div>
                    <div className="h-6 bg-gray-700 rounded w-14"></div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <Card className="p-6 bg-[#1a1a1a] border-[#333] text-center">
            <p className="text-gray-400">No trading sessions found. Start your first session above.</p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {sessions.map((session: TradingSession) => (
              <Card key={session.id} className="p-6 bg-[#1a1a1a] border-[#333]">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="text-lg font-semibold text-white">
                      Session {session.id.substring(0, 8)}...
                    </h4>
                    <p className="text-sm text-gray-400">
                      Started: {formatDate(session.startTime)}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <span className={`font-medium ${getStatusColor(session.status)}`}>
                      {session.status.toUpperCase()}
                    </span>
                    
                    {session.status === 'running' && (
                      <Button 
                        onClick={() => handleStopTrading(session.id)}
                        disabled={isLoading}
                        size="sm"
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        Stop
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-gray-400">Total PnL</p>
                    <p className={`text-lg font-semibold ${session.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatCurrency(session.totalPnL)}
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-400">Budget</p>
                    <p className="text-lg font-semibold text-white">
                      {formatCurrency(session.config.totalBudget)}
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-400">Goal</p>
                    <p className="text-lg font-semibold text-white">
                      {formatCurrency(session.config.profitGoal)}
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-gray-400">Positions</p>
                    <p className="text-lg font-semibold text-white">
                      {session.positions}/{session.config.maxPositions}
                    </p>
                  </div>
                </div>

                {session.error && (
                  <div className="mt-4 p-3 bg-red-900/20 border border-red-500 rounded">
                    <p className="text-red-400 text-sm">Error: {session.error}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
