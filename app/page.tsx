'use client';

import { useState, useEffect, useCallback } from 'react';
import { Signal } from '@/lib/signals';
import { RiskMode, RISK_PROFILES, formatCurrency, formatPercent, calculateProgress } from '@/lib/risk';

interface ApiResponse {
  success: boolean;
  timestamp: string;
  signals: Signal[];
  errors?: string[];
  meta?: {
    assetsTracked: number;
    signalsGenerated: number;
    source: string;
  };
}

function getSignalColor(signal: string): string {
  switch (signal) {
    case 'STRONG_LONG': return 'text-green-400';
    case 'LONG': return 'text-green-300';
    case 'NEUTRAL': return 'text-gray-400';
    case 'SHORT': return 'text-red-300';
    case 'STRONG_SHORT': return 'text-red-400';
    default: return 'text-gray-400';
  }
}

function getSignalBg(signal: string): string {
  switch (signal) {
    case 'STRONG_LONG': return 'bg-green-500/20 border-green-500/50';
    case 'LONG': return 'bg-green-500/10 border-green-500/30';
    case 'NEUTRAL': return 'bg-gray-500/10 border-gray-500/30';
    case 'SHORT': return 'bg-red-500/10 border-red-500/30';
    case 'STRONG_SHORT': return 'bg-red-500/20 border-red-500/50';
    default: return 'bg-gray-500/10 border-gray-500/30';
  }
}

export default function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [riskMode, setRiskMode] = useState<RiskMode>('MEDIUM');
  const [capital, setCapital] = useState(5000);

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/signals');
      const data: ApiResponse = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.errors?.[0] || 'Failed to fetch signals');
      }
      
      setSignals(data.signals);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
    // Refresh every 5 minutes
    const interval = setInterval(fetchSignals, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  const progress = calculateProgress(capital);
  const profile = RISK_PROFILES[riskMode];

  return (
    <main className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span className="text-blue-400">⚡</span>
              Kraken Funding Rate Trader
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {loading ? 'Fetching signals...' : (
                <>
                  <span className="text-yellow-400">Paper Trading Mode</span>
                  {lastUpdate && ` • Updated: ${lastUpdate.toLocaleTimeString()}`}
                </>
              )}
            </p>
          </div>

          {/* Risk Mode Selector */}
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg overflow-hidden border border-gray-700">
              {(['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as RiskMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setRiskMode(mode)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    riskMode === mode
                      ? mode === 'ULTRA' ? 'bg-red-600' 
                      : mode === 'HIGH' ? 'bg-orange-600'
                      : mode === 'MEDIUM' ? 'bg-blue-600'
                      : 'bg-green-600'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            <button
              onClick={fetchSignals}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
            >
              <span className={loading ? 'animate-spin' : ''}>⟳</span>
              Refresh
            </button>
          </div>
        </div>

        {/* Capital & Progress */}
        <div className="bg-gray-800 rounded-xl p-6 mb-6 border border-gray-700">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-sm text-gray-400">Capital</p>
              <p className="text-3xl font-bold text-green-400">{formatCurrency(capital)}</p>
              <p className="text-sm text-gray-500 mt-1">Progress to £100k</p>
              <div className="w-64 h-2 bg-gray-700 rounded-full mt-2 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
                  style={{ width: `${progress.logProgress * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {(progress.logProgress * 100).toFixed(1)}% • {progress.doublings.toFixed(2)} / 4.32 doublings
              </p>
            </div>

            <div className="flex gap-8 text-center">
              <div>
                <p className="text-2xl font-bold">{signals.length}</p>
                <p className="text-xs text-gray-400">Assets</p>
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {signals.filter(s => s.signal !== 'NEUTRAL').length}
                </p>
                <p className="text-xs text-gray-400">Active Signals</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{profile.maxLeverage}x</p>
                <p className="text-xs text-gray-400">Max Leverage</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{(profile.riskPerTrade * 100).toFixed(0)}%</p>
                <p className="text-xs text-gray-400">Risk/Trade</p>
              </div>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-6">
            <p className="text-red-400">⚠️ {error}</p>
          </div>
        )}

        {/* Signals Grid */}
        {loading && signals.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <div className="animate-pulse">Loading signals from Kraken...</div>
          </div>
        ) : signals.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No signals available. Check your connection.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {signals.map((signal) => (
              <div
                key={signal.symbol}
                className={`rounded-xl border p-5 transition-all hover:scale-[1.02] ${getSignalBg(signal.signal)}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold">{signal.symbol}</span>
                    <span className="text-xs text-gray-500">/USD</span>
                  </div>
                  <span className={`text-sm font-semibold px-2 py-0.5 rounded ${getSignalColor(signal.signal)}`}>
                    {signal.signal.replace('_', ' ')}
                  </span>
                </div>

                {/* Price */}
                <div className="mb-4">
                  <p className="text-2xl font-mono">
                    ${signal.price.toLocaleString('en-US', { 
                      minimumFractionDigits: signal.price < 1 ? 4 : 2,
                      maximumFractionDigits: signal.price < 1 ? 4 : 2,
                    })}
                  </p>
                  <p className={`text-sm ${signal.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatPercent(signal.priceChange24h)} (24h)
                  </p>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500">Z-Score</p>
                    <p className={`font-mono font-semibold ${
                      Math.abs(signal.zScore) >= 2.5 ? 'text-yellow-400' :
                      Math.abs(signal.zScore) >= 2.0 ? 'text-blue-400' : 'text-gray-300'
                    }`}>
                      {signal.zScore >= 0 ? '+' : ''}{signal.zScore.toFixed(2)}σ
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Funding</p>
                    <p className={`font-mono ${signal.currentFundingRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatPercent(signal.currentFundingRate * 100, 4)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Annualized</p>
                    <p className={`font-mono ${signal.annualizedRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatPercent(signal.annualizedRate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Confidence</p>
                    <p className="font-mono text-gray-300">
                      {(signal.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>⚠️ This is for educational purposes. Not financial advice.</p>
          <p className="mt-1">Paper trading mode - add API keys to enable live trading</p>
        </div>
      </div>
    </main>
  );
}
