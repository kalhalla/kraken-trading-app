import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KRAKEN_FUTURES_BASE = 'https://futures.kraken.com/derivatives/api/v3';

const FUTURES_SYMBOLS: Record<string, string> = {
  'BTC': 'PF_XBTUSD',
  'ETH': 'PF_ETHUSD',
  'SOL': 'PF_SOLUSD',
  'XRP': 'PF_XRPUSD',
  'LINK': 'PF_LINKUSD',
  'LTC': 'PF_LTCUSD',
};

interface FundingRate {
  timestamp: string;
  fundingRate: number;
  relativeFundingRate: number;
}

async function fetchFundingRates(symbol: string): Promise<FundingRate[]> {
  const krakenSymbol = FUTURES_SYMBOLS[symbol];
  if (!krakenSymbol) return [];

  try {
    const response = await fetch(
      `${KRAKEN_FUTURES_BASE}/historicalfundingrates?symbol=${krakenSymbol}`,
      { 
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      }
    );

    if (!response.ok) {
      console.error(`HTTP ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    return data.result === 'success' ? (data.rates || []) : [];
  } catch (error) {
    console.error(`Error fetching ${symbol}:`, error);
    return [];
  }
}

async function fetchTickers(): Promise<Record<string, number>> {
  try {
    const response = await fetch(`${KRAKEN_FUTURES_BASE}/tickers`, {
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) return {};

    const data = await response.json();
    const prices: Record<string, number> = {};

    if (data.result === 'success' && data.tickers) {
      for (const ticker of data.tickers) {
        for (const [ourSymbol, krakenSymbol] of Object.entries(FUTURES_SYMBOLS)) {
          if (ticker.symbol === krakenSymbol) {
            prices[ourSymbol] = ticker.last || ticker.markPrice || 0;
            break;
          }
        }
      }
    }

    return prices;
  } catch (error) {
    console.error('Error fetching tickers:', error);
    return {};
  }
}

function analyzeAsset(symbol: string, rates: FundingRate[], price: number) {
  if (rates.length < 90) return null;

  const values = rates
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map(r => r.relativeFundingRate * 100);

  const lookback = values.slice(-90);
  const mean = lookback.reduce((a, b) => a + b, 0) / lookback.length;
  const variance = lookback.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / lookback.length;
  const std = Math.sqrt(variance);
  const currentRate = values[values.length - 1];
  const zScore = std > 0 ? (currentRate - mean) / std : 0;

  // Determine signal
  let signal = 'NEUTRAL';
  let confirmations = 0;

  const absZ = Math.abs(zScore);
  if (absZ >= 1.8) confirmations++;
  if (absZ >= 2.0) confirmations++;
  if (absZ >= 2.5) confirmations++;
  if (absZ >= 3.0) confirmations++;

  if (zScore >= 3.0 && confirmations >= 4) signal = 'ULTRA_SHORT';
  else if (zScore >= 2.5 && confirmations >= 3) signal = 'STRONG_SHORT';
  else if (zScore >= 2.0 && confirmations >= 2) signal = 'SHORT';
  else if (zScore <= -3.0 && confirmations >= 4) signal = 'ULTRA_LONG';
  else if (zScore <= -2.5 && confirmations >= 3) signal = 'STRONG_LONG';
  else if (zScore <= -2.0 && confirmations >= 2) signal = 'LONG';

  const edgeScore = Math.min(100, (absZ * 15) + (confirmations * 12));
  let winProbability = 0.50 + Math.min(0.15, absZ * 0.05) + (confirmations * 0.03);
  winProbability = Math.min(0.80, winProbability);

  return {
    symbol,
    price,
    currentRate,
    mean,
    std,
    zScore,
    signal,
    confirmations,
    confirmationDetails: [
      absZ >= 2.0 ? `Z-Score: ${zScore.toFixed(2)}σ` : null,
      absZ >= 2.5 ? 'Extreme deviation' : null,
      absZ >= 3.0 ? '🔥 Ultra extreme' : null,
    ].filter(Boolean),
    edgeScore,
    winProbability,
    isFundingReversing: false,
    timestamp: new Date().toISOString(),
    fundingHistory: rates.slice(-30),
  };
}

export async function GET(request: NextRequest) {
  try {
    console.log('Fetching funding data...');
    
    const symbols = Object.keys(FUTURES_SYMBOLS);
    
    // Fetch tickers for prices
    const prices = await fetchTickers();
    console.log('Prices fetched:', Object.keys(prices).length);

    // Fetch funding rates for each symbol
    const analyses = [];
    
    for (const symbol of symbols) {
      try {
        const rates = await fetchFundingRates(symbol);
        console.log(`${symbol}: ${rates.length} rates`);
        
        if (rates.length > 0) {
          const analysis = analyzeAsset(symbol, rates, prices[symbol] || 0);
          if (analysis) {
            analyses.push(analysis);
          }
        }
      } catch (err) {
        console.error(`Error analyzing ${symbol}:`, err);
      }
    }

    console.log(`Returning ${analyses.length} analyses`);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: analyses,
    });
  } catch (error) {
    console.error('Funding API error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch funding data',
        timestamp: new Date().toISOString(),
        data: []
      },
      { status: 500 }
    );
  }
}
