// Signal generation library
// Calculates Z-scores and generates trading signals based on funding rate extremes

import { FundingRate, TickerData } from './kraken';

export type SignalType = 'STRONG_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'STRONG_SHORT';

export interface Signal {
  symbol: string;
  signal: SignalType;
  zScore: number;
  currentFundingRate: number;
  annualizedRate: number;
  price: number;
  priceChange24h: number;
  confidence: number;
  timestamp: string;
}

export interface SignalConfig {
  lookbackPeriods: number;  // Number of funding periods for Z-score calculation
  zThreshold: number;       // Z-score threshold for basic signal
  strongZThreshold: number; // Z-score threshold for strong signal
}

const DEFAULT_CONFIG: SignalConfig = {
  lookbackPeriods: 90,      // ~30 days of 8-hour funding periods
  zThreshold: 2.0,
  strongZThreshold: 2.5,
};

/**
 * Calculate mean and standard deviation
 */
function calculateStats(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(variance);
  
  return { mean, std };
}

/**
 * Calculate Z-score for current funding rate
 */
export function calculateZScore(
  historicalRates: FundingRate[],
  currentRate: number,
  lookbackPeriods: number = DEFAULT_CONFIG.lookbackPeriods
): number {
  if (historicalRates.length < 10) return 0; // Not enough data
  
  // Use relativeFundingRate (percentage) for calculations
  const rates = historicalRates
    .slice(-lookbackPeriods)
    .map(r => r.relativeFundingRate);
  
  const { mean, std } = calculateStats(rates);
  
  if (std === 0) return 0; // Avoid division by zero
  
  return (currentRate - mean) / std;
}

/**
 * Generate trading signal based on Z-score
 */
export function generateSignal(
  zScore: number,
  config: SignalConfig = DEFAULT_CONFIG
): { signal: SignalType; confidence: number } {
  const absZ = Math.abs(zScore);
  
  if (zScore <= -config.strongZThreshold) {
    return { signal: 'STRONG_LONG', confidence: Math.min(absZ / 3, 1) };
  }
  if (zScore <= -config.zThreshold) {
    return { signal: 'LONG', confidence: Math.min(absZ / 3, 0.8) };
  }
  if (zScore >= config.strongZThreshold) {
    return { signal: 'STRONG_SHORT', confidence: Math.min(absZ / 3, 1) };
  }
  if (zScore >= config.zThreshold) {
    return { signal: 'SHORT', confidence: Math.min(absZ / 3, 0.8) };
  }
  
  return { signal: 'NEUTRAL', confidence: 0 };
}

/**
 * Analyze an asset and generate a complete signal
 */
export function analyzeAsset(
  symbol: string,
  ticker: TickerData,
  historicalRates: FundingRate[],
  config: SignalConfig = DEFAULT_CONFIG
): Signal {
  const currentFundingRate = ticker.fundingRate;
  
  // Calculate Z-score
  const zScore = calculateZScore(historicalRates, currentFundingRate, config.lookbackPeriods);
  
  // Generate signal
  const { signal, confidence } = generateSignal(zScore, config);
  
  // Calculate 24h price change
  const priceChange24h = ticker.open24h > 0 
    ? ((ticker.last - ticker.open24h) / ticker.open24h) * 100 
    : 0;
  
  // Annualize funding rate (3 funding periods per day * 365 days)
  const annualizedRate = currentFundingRate * 3 * 365 * 100;
  
  return {
    symbol,
    signal,
    zScore,
    currentFundingRate,
    annualizedRate,
    price: ticker.last,
    priceChange24h,
    confidence,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get signal color for UI
 */
export function getSignalColor(signal: SignalType): string {
  switch (signal) {
    case 'STRONG_LONG': return '#22c55e';  // Green
    case 'LONG': return '#4ade80';          // Light green
    case 'NEUTRAL': return '#6b7280';       // Gray
    case 'SHORT': return '#f87171';         // Light red
    case 'STRONG_SHORT': return '#ef4444';  // Red
  }
}

/**
 * Get signal description
 */
export function getSignalDescription(signal: SignalType): string {
  switch (signal) {
    case 'STRONG_LONG': return 'Shorts overleveraged - strong reversal expected';
    case 'LONG': return 'Shorts overleveraged - reversal likely';
    case 'NEUTRAL': return 'Market balanced - no clear edge';
    case 'SHORT': return 'Longs overleveraged - reversal likely';
    case 'STRONG_SHORT': return 'Longs overleveraged - strong reversal expected';
  }
}
