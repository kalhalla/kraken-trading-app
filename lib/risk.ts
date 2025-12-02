// Risk management utilities

export type RiskMode = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

export interface RiskProfile {
  mode: RiskMode;
  riskPerTrade: number;  // Percentage of capital
  maxLeverage: number;
  description: string;
}

export const RISK_PROFILES: Record<RiskMode, RiskProfile> = {
  LOW: {
    mode: 'LOW',
    riskPerTrade: 0.01,  // 1%
    maxLeverage: 3,
    description: 'Conservative - slow compounding',
  },
  MEDIUM: {
    mode: 'MEDIUM',
    riskPerTrade: 0.03,  // 3%
    maxLeverage: 7,
    description: 'Balanced growth',
  },
  HIGH: {
    mode: 'HIGH',
    riskPerTrade: 0.05,  // 5%
    maxLeverage: 10,
    description: 'Aggressive trading',
  },
  ULTRA: {
    mode: 'ULTRA',
    riskPerTrade: 0.10,  // 10%
    maxLeverage: 15,
    description: 'Maximum aggression',
  },
};

/**
 * Calculate position size based on Kelly-adjacent formula
 */
export function calculatePositionSize(
  capital: number,
  riskMode: RiskMode,
  confidence: number,  // 0-1 signal confidence
  stopLossPercent: number = 0.02  // Default 2% stop
): { 
  positionSize: number; 
  leverage: number;
  riskAmount: number;
} {
  const profile = RISK_PROFILES[riskMode];
  
  // Scale risk by signal confidence (Kelly-adjacent)
  const adjustedRisk = profile.riskPerTrade * confidence;
  const riskAmount = capital * adjustedRisk;
  
  // Position size = Risk Amount / Stop Loss %
  const basePositionSize = riskAmount / stopLossPercent;
  
  // Calculate implied leverage
  const impliedLeverage = basePositionSize / capital;
  
  // Cap leverage at max for risk mode
  const leverage = Math.min(impliedLeverage, profile.maxLeverage);
  const positionSize = capital * leverage;
  
  return {
    positionSize,
    leverage,
    riskAmount,
  };
}

/**
 * Calculate progress toward goal (log-scaled)
 */
export function calculateProgress(
  current: number,
  start: number = 5000,
  goal: number = 100000
): {
  linearProgress: number;
  logProgress: number;
  doublings: number;
  doublingsRemaining: number;
} {
  const linearProgress = (current - start) / (goal - start);
  
  // Log progress: how many doublings done vs total needed
  const totalDoublings = Math.log2(goal / start);  // ~4.32 for 5k->100k
  const completedDoublings = Math.log2(current / start);
  const logProgress = completedDoublings / totalDoublings;
  
  return {
    linearProgress: Math.max(0, Math.min(1, linearProgress)),
    logProgress: Math.max(0, Math.min(1, logProgress)),
    doublings: completedDoublings,
    doublingsRemaining: totalDoublings - completedDoublings,
  };
}

/**
 * Format currency
 */
export function formatCurrency(amount: number, currency: string = '£'): string {
  return `${currency}${amount.toLocaleString('en-GB', { 
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format percentage
 */
export function formatPercent(value: number, decimals: number = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}
