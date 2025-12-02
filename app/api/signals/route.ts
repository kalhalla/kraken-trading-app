// API Route: /api/signals
// Uses Kraken for current prices + Binance for historical funding rates (free!)

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
}

function calculateZScore(rates: number[], currentRate: number): number {
  if (rates.length < 10) return 0;
  
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / rates.length;
  const std = Math.sqrt(variance);
  
  if (std === 0) return 0;
  return (currentRate - mean) / std;
}

function generateSignal(zScore: number): { signal: SignalType; confidence: number } {
  const absZ = Math.abs(zScore);
  
  if (zScore <= -2.5) return { signal: 'STRONG_LONG', confidence: Math.min(absZ / 3, 1) };
  if (zScore <= -2.0) return { signal: 'LONG', confidence: Math.min(absZ / 3, 0.8) };
  if (zScore >= 2.5) return { signal: 'STRONG_SHORT', confidence: Math.min(absZ / 3, 1) };
  if (zScore >= 2.0) return { signal: 'SHORT', confidence: Math.min(absZ / 3, 0.8) };
  
  return { signal: 'NEUTRAL', confidence: 0 };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'KrakenTradingApp/1.0',
    },
    cache: 'no-store',
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}

async function getBinanceHistoricalFunding(symbol: string): Promise<number[]> {
  const binanceSymbol = BINANCE_SYMBOLS[symbol];
  if (!binanceSymbol) return [];
  
  try {
    // Get last 100 funding rate records (covers ~33 days at 8hr intervals)
    const url = `${BINANCE_BASE}/fapi/v1/fundingRate?symbol=${binanceSymbol}&limit=100`;
    const data = await fetchJson(url) as BinanceFundingRate[];
    
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }
    
    // Convert funding rates to numbers
    return data.map(d => parseFloat(d.fundingRate));
  } catch (error) {
    console.error(`Binance funding fetch error for ${symbol}:`, error);
    return [];
  }
}

export async function GET() {
  const errors: string[] = [];
  const signals: Signal[] = [];
  const debug: Record<string, unknown> = {};

  try {
    // Step 1: Get current prices from Kraken
    const krakenData = await fetchJson(`${KRAKEN_BASE}/derivatives/api/v3/tickers`) as {
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

        // Get historical funding from Binance (free!)
        const historicalRates = await getBinanceHistoricalFunding(symbol);
        
        debug[`${symbol}_historicalCount`] = historicalRates.length;

        // Current funding rate from Kraken
        const currentFundingRate = ticker.fundingRate;
        
        // Calculate Z-score using Binance historical data
        let zScore = 0;
        let signal: SignalType = 'NEUTRAL';
        let confidence = 0;

        if (historicalRates.length >= 10) {
          // Use historical mean/std from Binance, apply to current Kraken rate
          zScore = calculateZScore(historicalRates, currentFundingRate);
          const generated = generateSignal(zScore);
          signal = generated.signal;
          confidence = generated.confidence;
        } else {
          errors.push(`Insufficient historical data for ${symbol} (got ${historicalRates.length})`);
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
        });

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Error processing ${symbol}: ${msg}`);
      }
    }

    // Sort by absolute Z-score (strongest signals first)
    signals.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

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
        fundingHistorySource: 'Binance Futures (free)',
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
