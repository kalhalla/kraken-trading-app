import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalFundingRates, getTickers, FUTURES_SYMBOLS } from '@/lib/kraken';
import { analyzeAsset } from '@/lib/analysis';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/funding
 * 
 * Fetches funding rates and analysis for all supported assets
 * Query params:
 *   - symbols: comma-separated list of symbols (optional, defaults to all)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    
    // Determine which symbols to fetch
    const symbols = symbolsParam 
      ? symbolsParam.split(',').filter(s => FUTURES_SYMBOLS[s])
      : Object.keys(FUTURES_SYMBOLS);

    // Fetch tickers for current prices
    const tickers = await getTickers();

    // Fetch funding rates and analyze each symbol
    const analyses = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const fundingRates = await getHistoricalFundingRates(symbol);
          const price = tickers[symbol]?.price || 0;
          
          if (fundingRates.length === 0) {
            return { symbol, error: 'No funding data available' };
          }

          const analysis = analyzeAsset(symbol, fundingRates, price);
          
          if (!analysis) {
            return { symbol, error: 'Insufficient data for analysis' };
          }

          return {
            ...analysis,
            ticker: tickers[symbol] || null,
            fundingHistory: fundingRates.slice(-30), // Last 30 data points for charts
          };
        } catch (error) {
          console.error(`Error analyzing ${symbol}:`, error);
          return { symbol, error: 'Analysis failed' };
        }
      })
    );

    // Separate successful analyses from errors
    const successful = analyses.filter(a => !('error' in a));
    const failed = analyses.filter(a => 'error' in a);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: successful,
      errors: failed.length > 0 ? failed : undefined,
    });
  } catch (error) {
    console.error('Funding API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch funding data' },
      { status: 500 }
    );
  }
}
