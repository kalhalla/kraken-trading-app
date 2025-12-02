// API Route: /api/signals
// Fetches real data from Kraken Futures and generates trading signals

import { NextResponse } from 'next/server';
import { 
  getTickers, 
  getHistoricalFundingRates, 
  getTickerForSymbol,
  FUTURES_SYMBOLS 
} from '@/lib/kraken';
import { analyzeAsset, Signal } from '@/lib/signals';

export const dynamic = 'force-dynamic'; // Don't cache this route
export const revalidate = 0;

const ASSETS_TO_TRACK = ['BTC', 'ETH', 'SOL', 'XRP', 'LINK'];

export async function GET() {
  try {
    // Fetch all tickers first (single API call)
    const tickers = await getTickers();
    
    if (!tickers || tickers.length === 0) {
      return NextResponse.json(
        { error: 'Failed to fetch ticker data from Kraken' },
        { status: 502 }
      );
    }

    // Analyze each asset
    const signals: Signal[] = [];
    const errors: string[] = [];

    for (const symbol of ASSETS_TO_TRACK) {
      try {
        // Get ticker for this symbol
        const ticker = getTickerForSymbol(tickers, symbol);
        if (!ticker) {
          errors.push(`No ticker found for ${symbol}`);
          continue;
        }

        // Get historical funding rates
        const historicalRates = await getHistoricalFundingRates(symbol);
        if (historicalRates.length < 10) {
          errors.push(`Insufficient historical data for ${symbol}`);
          continue;
        }

        // Generate signal
        const signal = analyzeAsset(symbol, ticker, historicalRates);
        signals.push(signal);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Error analyzing ${symbol}: ${message}`);
      }
    }

    // Sort by absolute Z-score (strongest signals first)
    signals.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      signals,
      errors: errors.length > 0 ? errors : undefined,
      meta: {
        assetsTracked: ASSETS_TO_TRACK.length,
        signalsGenerated: signals.length,
        source: 'Kraken Futures API',
      }
    });

  } catch (error) {
    console.error('Signal generation error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
