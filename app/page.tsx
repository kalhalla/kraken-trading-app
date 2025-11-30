'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  AlertTriangle,
  CheckCircle,
  Activity,
  Settings,
  Wifi,
  WifiOff
} from 'lucide-react';

type SignalType = 'ULTRA_LONG' | 'STRONG_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'STRONG_SHORT' | 'ULTRA_SHORT';
type RiskMode = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

interface Analysis {
  symbol: string;
  price: number;
  currentRate: number;
  mean: number;
  std: number;
  zScore: number;
  signal: SignalType;
  confirmations: number;
  confirmationDetails: string[];
  edgeScore: number;
  winProbability: number;
  isFundingReversing: boolean;
  timestamp: string;
  fundingHistory?: Array<{ timestamp: string; relativeFundingRate: number }>;
  error?: string;
}

interface TradingState {
  capital: number;
  trades: any[];
  stats: {
    totalTrades: number;
    wins: number;
    losses: number;
    totalPnL: number;
  };
}

const RISK_PROFILES = {
  LOW: { risk: 0.02, leverage: 3 },
  MEDIUM: { risk: 0.03, leverage: 5 },
  HIGH: { risk: 0.05, leverage: 7 },
  ULTRA: { risk: 0.08, leverage: 10 },
};

export default function Home() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [riskMode, setRiskMode] = useState<RiskMode>('MEDIUM');
  const [selectedAsset, setSelectedAsset] = useState<Analysis | null>(null);
  
  // Trading state (persisted in localStorage)
  const [tradingState, setTradingState] = useState<TradingState>({
    capital: 5000,
    trades: [],
    stats: { totalTrades: 0, wins: 0, losses: 0, totalPnL: 0 }
  });

  // Load trading state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('tradingState');
    if (saved) {
      setTradingState(JSON.parse(saved));
    }
  }, []);

  // Save trading state to localStorage
  useEffect(() => {
    localStorage.setItem('tradingState', JSON.stringify(tradingState));
  }, [tradingState]);

  // Check if live trading is enabled
  useEffect(() => {
    fetch('/api/execute')
      .then(res => res.json())
      .then(data => setTradingEnabled(data.tradingEnabled))
      .catch(() => setTradingEnabled(false));
  }, []);

  // Fetch funding data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch('/api/funding');
      const data = await res.json();
      
      if (data.success) {
        setAnalyses(data.data);
        setLastUpdate(new Date(data.timestamp));
      } else {
        setError(data.error || 'Failed to fetch data');
      }
    } catch (err) {
      setError('Network error - could not connect to API');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchData();
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Calculate position size
  const calculatePosition = (analysis: Analysis) => {
    const profile = RISK_PROFILES[riskMode];
    let riskMultiplier = 1.0;
    
    if (analysis.signal.includes('ULTRA')) riskMultiplier = 1.5;
    else if (analysis.signal.includes('STRONG')) riskMultiplier = 1.2;
    
    const effectiveRisk = Math.min(profile.risk * riskMultiplier, 0.10);
    const riskAmount = tradingState.capital * effectiveRisk;
    
    return {
      riskAmount,
      leverage: profile.leverage,
      stopLoss: 0.015,
      takeProfit: 0.03,
    };
  };

  // Execute paper trade
  const executePaperTrade = (analysis: Analysis) => {
    const position = calculatePosition(analysis);
    const isWin = Math.random() < analysis.winProbability;
    const pnl = isWin 
      ? position.riskAmount * 2 
      : -position.riskAmount;
    
    const trade = {
      id: Date.now(),
      symbol: analysis.symbol,
      direction: analysis.signal.includes('LONG') ? 'LONG' : 'SHORT',
      pnl,
      isWin,
      timestamp: new Date().toISOString(),
    };

    setTradingState(prev => ({
      capital: prev.capital + pnl,
      trades: [trade, ...prev.trades].slice(0, 50),
      stats: {
        totalTrades: prev.stats.totalTrades + 1,
        wins: prev.stats.wins + (isWin ? 1 : 0),
        losses: prev.stats.losses + (isWin ? 0 : 1),
        totalPnL: prev.stats.totalPnL + pnl,
      }
    }));

    alert(`${isWin ? '✅ WIN' : '❌ LOSS'}: ${trade.direction} ${analysis.symbol}\nP&L: ${pnl >= 0 ? '+' : ''}£${pnl.toFixed(2)}`);
  };

  // Get actionable signals
  const actionableSignals = analyses.filter(a => a.signal !== 'NEUTRAL')
    .sort((a, b) => b.edgeScore - a.edgeScore);

  const getSignalBadge = (signal: SignalType) => {
    const config: Record<SignalType, { bg: string; text: string; Icon: any }> = {
      ULTRA_LONG: { bg: 'bg-gradient-to-r from-green-600 to-emerald-500', text: '🔥 ULTRA LONG', Icon: TrendingUp },
      STRONG_LONG: { bg: 'bg-green-600', text: '↑↑ STRONG LONG', Icon: TrendingUp },
      LONG: { bg: 'bg-green-500', text: '↑ LONG', Icon: TrendingUp },
      NEUTRAL: { bg: 'bg-gray-600', text: '― NEUTRAL', Icon: Minus },
      SHORT: { bg: 'bg-red-500', text: '↓ SHORT', Icon: TrendingDown },
      STRONG_SHORT: { bg: 'bg-red-600', text: '↓↓ STRONG SHORT', Icon: TrendingDown },
      ULTRA_SHORT: { bg: 'bg-gradient-to-r from-red-600 to-orange-500', text: '🔥 ULTRA SHORT', Icon: TrendingDown },
    };
    const { bg, text } = config[signal];
    return <span className={`px-2 py-1 rounded-full text-xs font-medium text-white ${bg}`}>{text}</span>;
  };

  const MiniChart = ({ data }: { data?: Array<{ relativeFundingRate: number }> }) => {
    if (!data || data.length === 0) return <div className="h-8 bg-gray-800 rounded" />;
    
    const values = data.map(d => d.relativeFundingRate * 100);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 32 - ((v - min) / range) * 32;
      return `${x},${y}`;
    }).join(' ');
    
    const color = values[values.length - 1] > 0 ? '#22c55e' : '#ef4444';
    
    return (
      <svg viewBox="0 0 100 32" className="w-full h-8" preserveAspectRatio="none">
        <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
      </svg>
    );
  };

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="text-blue-500" />
              Kraken Funding Rate Trader
            </h1>
            <div className="flex items-center gap-2 mt-1">
              {tradingEnabled ? (
                <span className="text-xs text-green-400 flex items-center gap-1">
                  <Wifi size={12} /> Live Trading Enabled
                </span>
              ) : (
                <span className="text-xs text-yellow-400 flex items-center gap-1">
                  <WifiOff size={12} /> Paper Trading Mode
                </span>
              )}
              {lastUpdate && (
                <span className="text-xs text-gray-500">
                  Updated: {lastUpdate.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Risk Mode Selector */}
            <div className="flex rounded-lg overflow-hidden border border-gray-700 text-sm">
              {(['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as RiskMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setRiskMode(mode)}
                  className={`px-3 py-1.5 ${
                    riskMode === mode
                      ? mode === 'ULTRA' ? 'bg-red-600' : mode === 'HIGH' ? 'bg-orange-600' : 'bg-blue-600'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Capital Display */}
        <div className="bg-gray-800/50 rounded-xl p-4 mb-6 border border-gray-700">
          <div className="flex flex-wrap justify-between items-center gap-4">
            <div>
              <div className="text-gray-400 text-sm">Capital</div>
              <div className={`text-3xl font-bold ${tradingState.capital >= 5000 ? 'text-green-400' : 'text-red-400'}`}>
                £{tradingState.capital.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold">{tradingState.stats.totalTrades}</div>
                <div className="text-xs text-gray-400">Trades</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${tradingState.stats.wins > tradingState.stats.losses ? 'text-green-400' : 'text-red-400'}`}>
                  {tradingState.stats.totalTrades > 0 
                    ? ((tradingState.stats.wins / tradingState.stats.totalTrades) * 100).toFixed(0) 
                    : 0}%
                </div>
                <div className="text-xs text-gray-400">Win Rate</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${tradingState.stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {tradingState.stats.totalPnL >= 0 ? '+' : ''}£{tradingState.stats.totalPnL.toFixed(0)}
                </div>
                <div className="text-xs text-gray-400">Total P&L</div>
              </div>
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Progress to £100k</span>
              <span>{((tradingState.capital / 100000) * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all"
                style={{ width: `${Math.min((tradingState.capital / 100000) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-red-500" size={20} />
              <span className="text-red-400">{error}</span>
            </div>
          </div>
        )}

        {/* Actionable Signals Alert */}
        {actionableSignals.length > 0 && (
          <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="text-yellow-500" />
              <span className="font-bold text-yellow-400">
                {actionableSignals.length} Actionable Signal{actionableSignals.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {actionableSignals.slice(0, 5).map(a => (
                <span key={a.symbol} className="text-sm bg-gray-800 px-2 py-1 rounded">
                  {a.symbol}: {a.signal.replace('_', ' ')} (Edge: {a.edgeScore.toFixed(0)})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Asset Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {loading && analyses.length === 0 ? (
            // Loading skeletons
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 animate-pulse">
                <div className="h-6 bg-gray-700 rounded w-1/3 mb-3" />
                <div className="h-4 bg-gray-700 rounded w-2/3 mb-2" />
                <div className="h-4 bg-gray-700 rounded w-1/2" />
              </div>
            ))
          ) : (
            analyses.map(analysis => {
              const isActionable = analysis.signal !== 'NEUTRAL';
              const position = isActionable ? calculatePosition(analysis) : null;
              
              return (
                <div
                  key={analysis.symbol}
                  className={`bg-gray-800/50 rounded-lg p-4 border transition-all cursor-pointer hover:border-blue-500 ${
                    analysis.signal.includes('ULTRA') ? 'border-yellow-500 glow-yellow' :
                    isActionable ? 'border-yellow-600/50' : 'border-gray-700'
                  }`}
                  onClick={() => setSelectedAsset(analysis)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg font-bold">{analysis.symbol}</span>
                    {getSignalBadge(analysis.signal)}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <div className="text-gray-400 text-xs">Price</div>
                      <div className="font-medium">${analysis.price?.toLocaleString() || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs">Z-Score</div>
                      <div className={`font-medium ${Math.abs(analysis.zScore) >= 2 ? 'text-yellow-400' : ''}`}>
                        {analysis.zScore?.toFixed(2) || '—'}σ
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs">Edge Score</div>
                      <div className="font-medium">{analysis.edgeScore?.toFixed(0) || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-400 text-xs">Win Prob</div>
                      <div className={`font-medium ${(analysis.winProbability || 0) >= 0.6 ? 'text-green-400' : ''}`}>
                        {((analysis.winProbability || 0) * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                  
                  <MiniChart data={analysis.fundingHistory} />
                  
                  {isActionable && position && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        executePaperTrade(analysis);
                      }}
                      className={`w-full mt-3 py-2 rounded font-medium text-sm ${
                        analysis.signal.includes('LONG') 
                          ? 'bg-green-600 hover:bg-green-500' 
                          : 'bg-red-600 hover:bg-red-500'
                      }`}
                    >
                      {position.leverage}x | Risk £{position.riskAmount.toFixed(0)}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>⚠️ This is for educational purposes. Not financial advice.</p>
          <p className="mt-1">
            {tradingEnabled 
              ? 'Connected to Kraken Futures API' 
              : 'Paper trading mode - add API keys to enable live trading'}
          </p>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedAsset && (
        <div 
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedAsset(null)}
        >
          <div 
            className="bg-gray-800 rounded-xl max-w-lg w-full p-6 border border-gray-700 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{selectedAsset.symbol} Analysis</h2>
              <button onClick={() => setSelectedAsset(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Signal</span>
                {getSignalBadge(selectedAsset.signal)}
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900 rounded-lg p-3">
                  <div className="text-gray-400 text-xs">Price</div>
                  <div className="text-lg font-bold">${selectedAsset.price?.toLocaleString()}</div>
                </div>
                <div className="bg-gray-900 rounded-lg p-3">
                  <div className="text-gray-400 text-xs">Funding Rate</div>
                  <div className={`text-lg font-bold ${selectedAsset.currentRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(selectedAsset.currentRate * 100).toFixed(4)}%
                  </div>
                </div>
                <div className="bg-gray-900 rounded-lg p-3">
                  <div className="text-gray-400 text-xs">Z-Score</div>
                  <div className="text-lg font-bold">{selectedAsset.zScore?.toFixed(2)}σ</div>
                </div>
                <div className="bg-gray-900 rounded-lg p-3">
                  <div className="text-gray-400 text-xs">Win Probability</div>
                  <div className="text-lg font-bold">{((selectedAsset.winProbability || 0) * 100).toFixed(0)}%</div>
                </div>
              </div>
              
              {selectedAsset.confirmationDetails && selectedAsset.confirmationDetails.length > 0 && (
                <div className="bg-gray-900 rounded-lg p-3">
                  <div className="text-gray-400 text-xs mb-2">Confirmations ({selectedAsset.confirmations})</div>
                  <ul className="text-sm space-y-1">
                    {selectedAsset.confirmationDetails.map((detail, i) => (
                      <li key={i} className="text-green-400">✓ {detail}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {selectedAsset.signal !== 'NEUTRAL' && (
                <button
                  onClick={() => {
                    executePaperTrade(selectedAsset);
                    setSelectedAsset(null);
                  }}
                  className={`w-full py-3 rounded-lg font-bold ${
                    selectedAsset.signal.includes('LONG')
                      ? 'bg-green-600 hover:bg-green-500'
                      : 'bg-red-600 hover:bg-red-500'
                  }`}
                >
                  Execute {selectedAsset.signal.includes('LONG') ? 'LONG' : 'SHORT'} Trade
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
