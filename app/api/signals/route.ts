// API Route: /api/signals
// Fetches real data from Kraken Futures and generates trading signals

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const KRAKEN_FUTURES_BASE = 'https://futures.kraken.com/derivatives/api/v3';

// PI_ = Perpetual Inverse (the main liquid contracts with funding data)
// These are the symbols that have historical funding rate data
const FUTURES_SYMBOLS: Record<string, { ticker: string; funding: string }> = {
  'BTC': { ticker: 'pf_xbtusd', funding: 'PI_XBTUSD' },
  'ETH': { ticker: 'pf_ethusd', funding: 'PI_ETHUSD' },
  'SOL': { ticker: 'pf_solusd', funding: 'PI_SOLUSD' },
  'XRP': { ticker: 'pf_xrpusd', funding: 'PI_XRPUSD' },
  'LINK': { ticker: 'pf_linkusd', funding: 'PI_LINKUSD' },
};

const ASSETS_TO_TRACK = ['BTC', 'ETH', 'SOL', 'XRP', 'LINK'];

interface TickerData {
  symbol: string;
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

export async function GET() {
  const errors: string[] = [];
  const signals: Signal[] = [];
  const debug: Record<string, unknown> = {};

  try {
    // Fetch all tickers
    const tickersResponse = await fetch(`${KRAKEN_FUTURES_BASE}/tickers`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'KrakenTradingApp/1.0',
      },
      cache: 'no-store',
    });

    if (!tickersResponse.ok) {
      const text = await tickersResponse.text();
      return NextResponse.json({
        success: false,
        error: `Kraken tickers API error: ${tickersResponse.status}`,
        details: text.slice(0, 500),
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
    debug.tickerCount = tickers.length;
    debug.sampleTickers = tickers.slice(0, 5).map(t => t.symbol);

    // Process each asset
    for (const symbol of ASSETS_TO_TRACK) {
      try {
        const symbolConfig = FUTURES_SYMBOLS[symbol];
        
        // Find ticker - try multiple symbol formats
        let ticker = tickers.find(t => 
          t.symbol.toLowerCase() === symbolConfig.ticker.toLowerCase()
        );
        
        // Also try PI_ format for ticker
        if (!ticker) {
          ticker = tickers.find(t => 
            t.symbol.toLowerCase() === symbolConfig.funding.toLowerCase()
          );
        }

        if (!ticker) {
          errors.push(`No ticker for ${symbol}`);
          continue;
        }

        // Fetch historical funding rates using PI_ symbol
        const fundingUrl = `${KRAKEN_FUTURES_BASE}/historicalfundingrates?symbol=${symbolConfig.funding}`;
        const fundingResponse = await fetch(fundingUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'KrakenTradingApp/1.0',
          },
          cache: 'no-store',
        });

        if (!fundingResponse.ok) {
          // Try lowercase
          const fundingUrl2 = `${KRAKEN_FUTURES_BASE}/historicalfundingrates?symbol=${symbolConfig.funding.toLowerCase()}`;
          const fundingResponse2 = await fetch(fundingUrl2, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'User-Agent': 'KrakenTradingApp/1.0' },
            cache: 'no-store',
          });
          
          if (!fundingResponse2.ok) {
            errors.push(`Funding fetch failed for ${symbol}: ${fundingResponse.status}`);
            continue;
          }
          
          const fundingData2 = await fundingResponse2.json();
          if (fundingData2.result === 'success' && fundingData2.rates?.length > 0) {
            // Use this data
            const rates: FundingRate[] = fundingData2.rates;
            processSignal(symbol, ticker, rates, signals);
            continue;
          }
        }

        const fundingData = await fundingResponse.json();
        
        // Debug: log what we got
        if (!debug[`funding_${symbol}`]) {
          debug[`funding_${symbol}`] = {
            result: fundingData.result,
            ratesCount: fundingData.rates?.length || 0,
            error: fundingData.error,
          };
        }

        if (fundingData.result !== 'success') {
          errors.push(`Funding API error for ${symbol}: ${fundingData.error || fundingData.result}`);
          continue;
        }

        if (!fundingData.rates || fundingData.rates.length === 0) {
          errors.push(`No funding rates returned for ${symbol}`);
          continue;
        }

        const rates: FundingRate[] = fundingData.rates;
        processSignal(symbol, ticker, rates, signals);

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

function processSignal(symbol: string, ticker: TickerData, rates: FundingRate[], signals: Signal[]) {
  const recentRates = rates.slice(-90).map(r => r.relativeFundingRate);
  const currentRate = ticker.fundingRate;

  // Calculate Z-score
  const zScore = calculateZScore(recentRates, currentRate);
  const { signal, confidence } = generateSignal(zScore);

  // Calculate 24h price change
  const priceChange24h = ticker.open24h > 0 
    ? ((ticker.last - ticker.open24h) / ticker.open24h) * 100 
    : 0;

  // Annualize funding rate (3 periods/day * 365 days)
  const annualizedRate = currentRate * 3 * 365 * 100;

  signals.push({
    symbol,
    signal,
    zScore,
    currentFundingRate: currentRate,
    annualizedRate,
    price: ticker.last,
    priceChange24h,
    confidence,
    timestamp: new Date().toISOString(),
  });
}
