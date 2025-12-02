// API Route: /api/signals
// Uses Kraken for current prices + Binance for historical funding rates
// Falls back to absolute thresholds if historical data unavailable

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const KRAKEN_BASE = 'https://futures.kraken.com';
const BINANCE_BASE = 'https://fapi.binance.com';

const ASSETS_TO_TRACK = ['BTC', 'ETH', 'SOL', 'XRP', 'LINK'];

// Kraken symbol mapping
const KRAKEN_SYMBOLS: Record<string, string> = {
  'BTC': 'xbt',
  'ETH': 'eth',
  'SOL': 'sol',
  'XRP': 'xrp',
  'LINK': 'link',
};

// Binance symbol mapping
const BINANCE_SYMBOLS: Record<string, string> = {
  'BTC': 'BTCUSDT',
  'ETH': 'ETHUSDT',
  'SOL': 'SOLUSDT',
  'XRP': 'XRPUSDT',
  'LINK': 'LINKUSDT',
};

// Absolute funding rate thresholds (used when no historical data)
// Based on typical market ranges: neutral is ~0.01% per 8h (~10% annualized)
const FUNDING_THRESHOLDS = {
  STRONG_SHORT: 0.001,   // > 0.1% per 8h (~109% annualized) - very overleveraged long
  SHORT: 0.0005,         // > 0.05% per 8h (~55% annualized) - overleveraged long
  STRONG_LONG: -0.001,   // < -0.1% per 8h - very overleveraged short
  LONG: -0.0005,         // < -0.05% per 8h - overleveraged short
};

interface KrakenTicker {
  symbol: string;
  tag: string;
  markPrice: number;
  open24h: number;
  last: number;
  fundingRate: number;
}

interface BinanceFundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  markPrice: string;
}

type SignalType = 'STRONG_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'STRONG_SHORT';

interface Signal {
  symbol: string;
  signal: SignalType;
  zScore: number;
  currentFundingRate: number;
  annualizedRate: number;
  price: number;
  priceChange24h: number;
  confidence: number;
  timestamp: string;
  signalSource: 'zscore' | 'threshold';
}

function calculateZScore(rates: number[], currentRate: number): number {
  if (rates.length < 10) return 0;
  
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / rates.length;
  const std = Math.sqrt(variance);
  
  if (std === 0) return 0;
  return (currentRate - mean) / std;
}

function generateSignalFromZScore(zScore: number): { signal: SignalType; confidence: number } {
  const absZ = Math.abs(zScore);
  
  if (zScore <= -2.5) return { signal: 'STRONG_LONG', confidence: Math.min(absZ / 3, 1) };
  if (zScore <= -2.0) return { signal: 'LONG', confidence: Math.min(absZ / 3, 0.8) };
  if (zScore >= 2.5) return { signal: 'STRONG_SHORT', confidence: Math.min(absZ / 3, 1) };
  if (zScore >= 2.0) return { signal: 'SHORT', confidence: Math.min(absZ / 3, 0.8) };
  
  return { signal: 'NEUTRAL', confidence: 0 };
}

function generateSignalFromThreshold(fundingRate: number): { signal: SignalType; confidence: number } {
  // Use absolute thresholds when no historical data available
  if (fundingRate >= FUNDING_THRESHOLDS.STRONG_SHORT) {
    return { signal: 'STRONG_SHORT', confidence: 0.7 };
  }
  if (fundingRate >= FUNDING_THRESHOLDS.SHORT) {
    return { signal: 'SHORT', confidence: 0.5 };
  }
  if (fundingRate <= FUNDING_THRESHOLDS.STRONG_LONG) {
    return { signal: 'STRONG_LONG', confidence: 0.7 };
  }
  if (fundingRate <= FUNDING_THRESHOLDS.LONG) {
    return { signal: 'LONG', confidence: 0.5 };
  }
  return { signal: 'NEUTRAL', confidence: 0 };
}

async function getBinanceHistoricalFunding(symbol: string): Promise<{ rates: number[]; error?: string; rawResponse?: string }> {
  const binanceSymbol = BINANCE_SYMBOLS[symbol];
  if (!binanceSymbol) return { rates: [], error: 'Unknown symbol' };
  
  try {
    const url = `${BINANCE_BASE}/fapi/v1/fundingRate?symbol=${binanceSymbol}&limit=100`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
      },
      cache: 'no-store',
    });
    
    const text = await response.text();
    
    if (!response.ok) {
      return { 
        rates: [], 
        error: `HTTP ${response.status}`,
        rawResponse: text.slice(0, 200)
      };
    }
    
    let data: BinanceFundingRate[];
    try {
      data = JSON.parse(text);
    } catch {
      return { rates: [], error: 'JSON parse failed', rawResponse: text.slice(0, 200) };
    }
    
    if (!Array.isArray(data)) {
      return { 
        rates: [], 
        error: 'Response not array',
        rawResponse: JSON.stringify(data).slice(0, 200)
      };
    }
    
    if (data.length === 0) {
      return { rates: [], error: 'Empty array returned' };
    }
    
    return { rates: data.map(d => parseFloat(d.fundingRate)) };
  } catch (error) {
    return { 
      rates: [], 
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function GET() {
  const errors: string[] = [];
  const signals: Signal[] = [];
  const debug: Record<string, unknown> = {};

  try {
    // Step 1: Get current prices from Kraken
    const krakenResponse = await fetch(`${KRAKEN_BASE}/derivatives/api/v3/tickers`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    
    if (!krakenResponse.ok) {
      return NextResponse.json({
        success: false,
        error: `Kraken API error: ${krakenResponse.status}`,
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    const krakenData = await krakenResponse.json() as {
      result: string;
      tickers: KrakenTicker[];
    };

    if (krakenData.result !== 'success') {
      return NextResponse.json({
        success: false,
        error: `Kraken API returned: ${krakenData.result}`,
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    const tickers = krakenData.tickers || [];
    const perpetualTickers = tickers.filter(t => t.tag === 'perpetual');
    
    debug.krakenTickerCount = tickers.length;
    debug.perpetualCount = perpetualTickers.length;

    // Step 2: Process each asset
    for (const symbol of ASSETS_TO_TRACK) {
      try {
        const krakenSymbol = KRAKEN_SYMBOLS[symbol];
        
        // Find Kraken ticker for current price
        const ticker = perpetualTickers.find(t => {
          const s = t.symbol.toLowerCase();
          return s === `pf_${krakenSymbol}usd` || s === `pi_${krakenSymbol}usd`;
        });

        if (!ticker) {
          errors.push(`No Kraken ticker for ${symbol}`);
          continue;
        }

        // Get historical funding from Binance
        const binanceResult = await getBinanceHistoricalFunding(symbol);
        
        debug[`${symbol}_binance`] = {
          count: binanceResult.rates.length,
          error: binanceResult.error,
          raw: binanceResult.rawResponse,
        };

        // Current funding rate from Kraken
        const currentFundingRate = ticker.fundingRate;
        
        // Calculate signal
        let zScore = 0;
        let signal: SignalType = 'NEUTRAL';
        let confidence = 0;
        let signalSource: 'zscore' | 'threshold' = 'threshold';

        if (binanceResult.rates.length >= 10) {
          // Use Z-score method with historical data
          zScore = calculateZScore(binanceResult.rates, currentFundingRate);
          const generated = generateSignalFromZScore(zScore);
          signal = generated.signal;
          confidence = generated.confidence;
          signalSource = 'zscore';
        } else {
          // Fallback: use absolute thresholds
          const generated = generateSignalFromThreshold(currentFundingRate);
          signal = generated.signal;
          confidence = generated.confidence;
          signalSource = 'threshold';
          
          if (binanceResult.error) {
            errors.push(`${symbol}: Binance ${binanceResult.error}, using thresholds`);
          }
        }

        // Calculate 24h price change
        const priceChange24h = ticker.open24h > 0 
          ? ((ticker.last - ticker.open24h) / ticker.open24h) * 100 
          : 0;

        // Annualize funding rate (3 periods/day * 365 days)
        const annualizedRate = currentFundingRate * 3 * 365 * 100;

        signals.push({
          symbol,
          signal,
          zScore,
          currentFundingRate,
          annualizedRate,
          price: ticker.last,
          priceChange24h,
          confidence,
          timestamp: new Date().toISOString(),
          signalSource,
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Error processing ${symbol}: ${msg}`);
      }
    }

    // Sort by absolute Z-score, then by signal strength
    signals.sort((a, b) => {
      // First by signal type (STRONG > regular > NEUTRAL)
      const signalOrder: Record<SignalType, number> = {
        'STRONG_SHORT': 2, 'STRONG_LONG': 2,
        'SHORT': 1, 'LONG': 1,
        'NEUTRAL': 0
      };
      const orderDiff = signalOrder[b.signal] - signalOrder[a.signal];
      if (orderDiff !== 0) return orderDiff;
      
      // Then by Z-score magnitude
      return Math.abs(b.zScore) - Math.abs(a.zScore);
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      signals,
      errors: errors.length > 0 ? errors : undefined,
      debug,
      meta: {
        assetsTracked: ASSETS_TO_TRACK.length,
        signalsGenerated: signals.length,
        priceSource: 'Kraken Futures',
        fundingHistorySource: 'Binance Futures (with threshold fallback)',
      }
    });

  } catch (error) {
    console.error('Signal generation error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
