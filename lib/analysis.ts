/**
 * Trading Strategy: Funding Rate Mean Reversion
 * 
 * Core Logic:
 * - Calculate Z-score of current funding rate vs historical mean
 * - Generate signals when funding is extreme (>2 std deviations)
 * - Stack multiple confirmations to increase confidence
 */

import { FundingRate } from './kraken';

export type SignalType = 
  | 'ULTRA_LONG' 
  | 'STRONG_LONG' 
  | 'LONG' 
  | 'NEUTRAL' 
  | 'SHORT' 
  | 'STRONG_SHORT' 
  | 'ULTRA_SHORT';

export interface Analysis {
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
  timestamp: Date;
}

export interface PositionSize {
  positionSize: number;
  leverage: number;
  riskAmount: number;
  riskPercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  expectedValue: number;
}

export const RISK_PROFILES = {
  LOW: { risk: 0.02, leverage: 3, minConfirmations: 2, minZ: 1.8 },
  MEDIUM: { risk: 0.03, leverage: 5, minConfirmations: 3, minZ: 2.0 },
  HIGH: { risk: 0.05, leverage: 7, minConfirmations: 4, minZ: 2.5 },
  ULTRA: { risk: 0.08, leverage: 10, minConfirmations: 5, minZ: 3.0 },
} as const;

export type RiskMode = keyof typeof RISK_PROFILES;

/**
 * Analyze funding rate data and generate trading signals
 */
export function analyzeAsset(
  symbol: string,
  fundingRates: FundingRate[],
  currentPrice: number,
  lookbackPeriods: number = 90
): Analysis | null {
  if (fundingRates.length < lookbackPeriods) {
    console.warn(`Insufficient data for ${symbol}: ${fundingRates.length} < ${lookbackPeriods}`);
    return null;
  }

  // Sort by timestamp and get recent data
  const sortedRates = [...fundingRates]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  const rates = sortedRates.map(r => r.relativeFundingRate * 100); // Convert to percentage
  const lookback = rates.slice(-lookbackPeriods);

  // Calculate statistics
  const mean = lookback.reduce((a, b) => a + b, 0) / lookback.length;
  const variance = lookback.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / lookback.length;
  const std = Math.sqrt(variance);

  const currentRate = rates[rates.length - 1];
  const zScore = std > 0 ? (currentRate - mean) / std : 0;

  // Check funding trend (last 6 periods = ~2 days)
  const recentRates = rates.slice(-6);
  const fundingTrend = recentRates.length >= 2 
    ? (recentRates[recentRates.length - 1] - recentRates[0]) / (recentRates.length - 1)
    : 0;
  
  const isFundingReversing = 
    (currentRate > mean && fundingTrend < 0) || 
    (currentRate < mean && fundingTrend > 0);

  // Count confirmations
  let confirmations = 0;
  const confirmationDetails: string[] = [];

  const absZ = Math.abs(zScore);
  
  if (absZ >= 1.8) {
    confirmations++;
    confirmationDetails.push(`Z-Score: ${zScore.toFixed(2)}σ`);
  }
  if (absZ >= 2.0) {
    confirmations++;
    confirmationDetails.push('Above 2σ threshold');
  }
  if (absZ >= 2.5) {
    confirmations++;
    confirmationDetails.push('Extreme deviation (2.5σ+)');
  }
  if (absZ >= 3.0) {
    confirmations++;
    confirmationDetails.push('🔥 Ultra extreme (3σ+)');
  }
  if (isFundingReversing) {
    confirmations++;
    confirmationDetails.push('Funding trend reversing');
  }
  
  // Historical extreme check
  const historicalMax = Math.max(...lookback);
  const historicalMin = Math.min(...lookback);
  if (currentRate > historicalMax * 0.9 || currentRate < historicalMin * 0.9) {
    confirmations++;
    confirmationDetails.push('Near historical extreme');
  }

  // Determine signal
  let signal: SignalType = 'NEUTRAL';
  
  if (zScore >= 3.0 && confirmations >= 5) signal = 'ULTRA_SHORT';
  else if (zScore >= 2.5 && confirmations >= 4) signal = 'STRONG_SHORT';
  else if (zScore >= 2.0 && confirmations >= 3) signal = 'SHORT';
  else if (zScore >= 1.8 && confirmations >= 2) signal = 'SHORT';
  else if (zScore <= -3.0 && confirmations >= 5) signal = 'ULTRA_LONG';
  else if (zScore <= -2.5 && confirmations >= 4) signal = 'STRONG_LONG';
  else if (zScore <= -2.0 && confirmations >= 3) signal = 'LONG';
  else if (zScore <= -1.8 && confirmations >= 2) signal = 'LONG';

  // Calculate edge score (0-100)
  const edgeScore = Math.min(100, (absZ * 15) + (confirmations * 12));

  // Estimate win probability
  let winProbability = 0.50;
  winProbability += Math.min(0.15, absZ * 0.05);
  winProbability += confirmations * 0.03;
  if (isFundingReversing) winProbability += 0.05;
  winProbability = Math.min(0.80, winProbability);

  return {
    symbol,
    price: currentPrice,
    currentRate,
    mean,
    std,
    zScore,
    signal,
    confirmations,
    confirmationDetails,
    edgeScore,
    winProbability,
    isFundingReversing,
    timestamp: new Date(),
  };
}

/**
 * Calculate position size based on risk profile and signal strength
 */
export function calculatePosition(
  analysis: Analysis,
  capital: number,
  riskMode: RiskMode
): PositionSize {
  const profile = RISK_PROFILES[riskMode];

  // Adjust risk based on signal strength
  let riskMultiplier = 1.0;
  let leverageMultiplier = 1.0;

  if (analysis.signal.includes('ULTRA')) {
    riskMultiplier = 1.5;
    leverageMultiplier = 1.3;
  } else if (analysis.signal.includes('STRONG')) {
    riskMultiplier = 1.2;
    leverageMultiplier = 1.15;
  }

  const effectiveRisk = Math.min(profile.risk * riskMultiplier, 0.10); // Cap at 10%
  const effectiveLeverage = Math.min(Math.round(profile.leverage * leverageMultiplier), 15); // Cap at 15x

  const riskAmount = capital * effectiveRisk;
  const stopLossPercent = 0.015; // 1.5% stop loss
  const takeProfitPercent = stopLossPercent * 2; // 2:1 reward:risk

  const positionSize = riskAmount / stopLossPercent;
  const isLong = analysis.signal.includes('LONG');

  const stopLossPrice = isLong
    ? analysis.price * (1 - stopLossPercent)
    : analysis.price * (1 + stopLossPercent);

  const takeProfitPrice = isLong
    ? analysis.price * (1 + takeProfitPercent)
    : analysis.price * (1 - takeProfitPercent);

  const expectedValue = 
    (analysis.winProbability * takeProfitPercent) - 
    ((1 - analysis.winProbability) * stopLossPercent);

  return {
    positionSize: Math.min(positionSize, capital * 0.4), // Max 40% of capital
    leverage: effectiveLeverage,
    riskAmount,
    riskPercent: effectiveRisk,
    stopLossPercent,
    takeProfitPercent,
    stopLossPrice,
    takeProfitPrice,
    expectedValue,
  };
}

/**
 * Get signal color for UI
 */
export function getSignalColor(signal: SignalType): string {
  switch (signal) {
    case 'ULTRA_LONG':
    case 'STRONG_LONG':
      return 'text-green-400';
    case 'LONG':
      return 'text-green-500';
    case 'ULTRA_SHORT':
    case 'STRONG_SHORT':
      return 'text-red-400';
    case 'SHORT':
      return 'text-red-500';
    default:
      return 'text-gray-400';
  }
}

/**
 * Get signal background color for badges
 */
export function getSignalBgColor(signal: SignalType): string {
  switch (signal) {
    case 'ULTRA_LONG':
      return 'bg-gradient-to-r from-green-600 to-emerald-500';
    case 'STRONG_LONG':
      return 'bg-green-600';
    case 'LONG':
      return 'bg-green-500';
    case 'ULTRA_SHORT':
      return 'bg-gradient-to-r from-red-600 to-orange-500';
    case 'STRONG_SHORT':
      return 'bg-red-600';
    case 'SHORT':
      return 'bg-red-500';
    default:
      return 'bg-gray-600';
  }
}
