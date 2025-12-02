// Kraken Futures API wrapper
// All market data endpoints are FREE - no API key required

const KRAKEN_FUTURES_BASE = 'https://futures.kraken.com/derivatives/api/v3';

// Perpetual futures symbols (PF_ prefix)
export const FUTURES_SYMBOLS: Record<string, string> = {
  'BTC': 'PF_XBTUSD',
  'ETH': 'PF_ETHUSD',
  'SOL': 'PF_SOLUSD',
  'XRP': 'PF_XRPUSD',
  'LINK': 'PF_LINKUSD',
  'LTC': 'PF_LTCUSD',
  'DOGE': 'PF_DOGEUSD',
  'ADA': 'PF_ADAUSD',
  'AVAX': 'PF_AVAXUSD',
  'MATIC': 'PF_MATICUSD',
};

export interface FundingRate {
  timestamp: string;
  fundingRate: number;
  relativeFundingRate: number;
}

export interface TickerData {
  symbol: string;
  tag: string;
  pair: string;
  markPrice: number;
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
  vol24h: number;
  openInterest: number;
  open24h: number;
  last: number;
  lastTime: string;
  lastSize: number;
  suspended: boolean;
  fundingRate: number;
  fundingRatePrediction: number;
  indexPrice: number;
}

export interface KrakenTickersResponse {
  result: string;
  tickers: TickerData[];
  serverTime: string;
}

export interface KrakenFundingResponse {
  result: string;
  rates: FundingRate[];
}

/**
 * Fetch all tickers - includes current funding rates
 * FREE - No API key required
 */
export async function getTickers(): Promise<TickerData[]> {
  const response = await fetch(`${KRAKEN_FUTURES_BASE}/tickers`, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 30 }, // Cache for 30 seconds
  });

  if (!response.ok) {
    throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
  }

  const data: KrakenTickersResponse = await response.json();
  
  if (data.result !== 'success') {
    throw new Error(`Kraken API returned error: ${data.result}`);
  }

  // Filter to only perpetual futures (PF_ symbols)
  return data.tickers.filter(t => t.symbol.startsWith('pf_') || t.symbol.startsWith('PF_'));
}

/**
 * Fetch historical funding rates for a symbol
 * FREE - No API key required
 */
export async function getHistoricalFundingRates(symbol: string): Promise<FundingRate[]> {
  const krakenSymbol = FUTURES_SYMBOLS[symbol.toUpperCase()];
  if (!krakenSymbol) {
    console.warn(`Unknown symbol: ${symbol}, skipping`);
    return [];
  }

  const response = await fetch(
    `${KRAKEN_FUTURES_BASE}/historicalfundingrates?symbol=${krakenSymbol}`,
    {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 300 }, // Cache for 5 minutes
    }
  );

  if (!response.ok) {
    console.error(`Failed to fetch funding rates for ${symbol}: ${response.status}`);
    return [];
  }

  const data: KrakenFundingResponse = await response.json();
  
  if (data.result !== 'success') {
    console.error(`Kraken API error for ${symbol}: ${data.result}`);
    return [];
  }

  return data.rates || [];
}

/**
 * Get ticker for a specific symbol
 */
export function getTickerForSymbol(tickers: TickerData[], symbol: string): TickerData | undefined {
  const krakenSymbol = FUTURES_SYMBOLS[symbol.toUpperCase()];
  if (!krakenSymbol) return undefined;
  
  return tickers.find(t => 
    t.symbol.toLowerCase() === krakenSymbol.toLowerCase()
  );
}
