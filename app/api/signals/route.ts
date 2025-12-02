// API Route: /api/signals
// Fetches real data from Kraken Futures and generates trading signals

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const KRAKEN_BASE = 'https://futures.kraken.com';

const ASSETS_TO_TRACK = ['BTC', 'ETH', 'SOL', 'XRP', 'LINK'];

// Map display symbols to Kraken symbols
const SYMBOL_MAP: Record<string, string> = {
  'BTC': 'xbt',
  'ETH': 'eth',
  'SOL': 'sol',
  'XRP': 'xrp',
  'LINK': 'link',
};

interface TickerData {
  symbol: string;
  tag: string;
  markPrice: number;
  bid: number;
  ask: number;
  vol24h: number;
  openInterest: number;
  open24h: number;
  last: number;
  lastTime: string;
  fundingRate: number;
  fundingRatePrediction: number;
}

interface FundingRate {
  timestamp: string;
  fundingRate: number;
  relativeFundingRate: number;
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

async function fetchWithRetry(url: string): Promise<Response> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'KrakenTradingApp/1.0',
    },
    cache: 'no-store',
  });
  return response;
}

async function fetchFundingRates(symbol: string): Promise<{ rates: FundingRate[] | null; error?: string; url?: string }> {
  const krakenSymbol = symbol === 'BTC' ? 'xbt' : symbol.toLowerCase();
  
  // Try multiple URL formats and symbol formats
  const urlFormats = [
    // PF_ format (Perpetual Fixed) - lowercase
    `${KRAKEN_BASE}/derivatives/api/v3/historicalfundingrates?symbol=pf_${krakenSymbol}usd`,
    // PF_ format - uppercase
    `${KRAKEN_BASE}/derivatives/api/v3/historicalfundingrates?symbol=PF_${krakenSymbol.toUpperCase()}USD`,
    // PI_ format (Perpetual Inverse) - lowercase
    `${KRAKEN_BASE}/derivatives/api/v3/historicalfundingrates?symbol=pi_${krakenSymbol}usd`,
    // PI_ format - uppercase  
    `${KRAKEN_BASE}/derivatives/api/v3/historicalfundingrates?symbol=PI_${krakenSymbol.toUpperCase()}USD`,
    // New API path with hyphens
    `${KRAKEN_BASE}/api/v3/historical-funding-rates?symbol=pf_${krakenSymbol}usd`,
    `${KRAKEN_BASE}/api/v3/historical-funding-rates?symbol=PF_${krakenSymbol.toUpperCase()}USD`,
  ];

  for (const url of urlFormats) {
    try {
      const response = await fetchWithRetry(url);
      
      if (response.ok) {
        const data = await response.json();
        if (data.result === 'success' && data.rates && data.rates.length > 0) {
          return { rates: data.rates, url };
        }
      }
    } catch {
      // Continue to next URL
    }
  }

  return { rates: null, error: 'All URL formats failed' };
}

export async function GET() {
  const errors: string[] = [];
  const signals: Signal[] = [];
  const debug: Record<string, unknown> = {};

  try {
    // Fetch all tickers
    const tickersResponse = await fetchWithRetry(`${KRAKEN_BASE}/derivatives/api/v3/tickers`);

    if (!tickersResponse.ok) {
      return NextResponse.json({
        success: false,
        error: `Kraken tickers API error: ${tickersResponse.status}`,
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    const tickersData = await tickersResponse.json();

    if (tickersData.result !== 'success') {
      return NextResponse.json({
        success: false,
        error: `Kraken API returned: ${tickersData.result}`,
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    const tickers: TickerData[] = tickersData.tickers || [];
    
    // Find perpetual tickers
    const perpetualTickers = tickers.filter(t => t.tag === 'perpetual');
    debug.tickerCount = tickers.length;
    debug.perpetualCount = perpetualTickers.length;
    debug.perpetualSymbols = perpetualTickers.slice(0, 10).map(t => t.symbol);

    // Process each asset
    for (const symbol of ASSETS_TO_TRACK) {
      try {
        const krakenSymbol = SYMBOL_MAP[symbol];
        
        // Find ticker - look for perpetual USD pair
        const ticker = perpetualTickers.find(t => {
          const s = t.symbol.toLowerCase();
          return s === `pf_${krakenSymbol}usd` || 
                 s === `pi_${krakenSymbol}usd`;
        });

        if (!ticker) {
          errors.push(`No perpetual ticker for ${symbol}`);
          continue;
        }

        debug[`ticker_${symbol}`] = ticker.symbol;

        // Get current funding rate from ticker (this always works)
        const currentFundingRate = ticker.fundingRate;
        
        // Try to fetch historical rates
        const { rates, error: fundingError, url: workingUrl } = await fetchFundingRates(symbol);
        
        if (rates && rates.length >= 10) {
          debug[`funding_${symbol}`] = { count: rates.length, url: workingUrl };
          
          const recentRates = rates.slice(-90).map(r => r.relativeFundingRate);
          const zScore = calculateZScore(recentRates, currentFundingRate);
          const { signal, confidence } = generateSignal(zScore);

          const priceChange24h = ticker.open24h > 0 
            ? ((ticker.last - ticker.open24h) / ticker.open24h) * 100 
            : 0;

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
        } else {
          // Fallback: use current funding rate only (Z-score = 0)
          debug[`funding_${symbol}`] = { error: fundingError || 'No data' };
          
          const priceChange24h = ticker.open24h > 0 
            ? ((ticker.last - ticker.open24h) / ticker.open24h) * 100 
            : 0;

          const annualizedRate = currentFundingRate * 3 * 365 * 100;

          signals.push({
            symbol,
            signal: 'NEUTRAL',
            zScore: 0,
            currentFundingRate,
            annualizedRate,
            price: ticker.last,
            priceChange24h,
            confidence: 0,
            timestamp: new Date().toISOString(),
          });
          
          errors.push(`No historical funding for ${symbol}, using current rate only`);
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Error processing ${symbol}: ${msg}`);
      }
    }

    // Sort by absolute Z-score
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
        tickersReceived: tickers.length,
        source: 'Kraken Futures API',
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
