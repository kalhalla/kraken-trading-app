/**
 * Kraken Futures API Client
 * 
 * Public endpoints (FREE, no API key):
 * - Historical funding rates
 * - Current tickers
 * - Order book
 * 
 * Private endpoints (requires API key):
 * - Place orders
 * - Account balance
 * - Open positions
 */

import crypto from 'crypto';

const KRAKEN_FUTURES_BASE = 'https://futures.kraken.com/derivatives/api/v3';
const KRAKEN_SPOT_BASE = 'https://api.kraken.com/0/public';

// Symbol mappings
export const FUTURES_SYMBOLS: Record<string, string> = {
  'BTC': 'PF_XBTUSD',
  'ETH': 'PF_ETHUSD',
  'SOL': 'PF_SOLUSD',
  'XRP': 'PF_XRPUSD',
  'LINK': 'PF_LINKUSD',
  'LTC': 'PF_LTCUSD',
  'ADA': 'PF_ADAUSD',
  'DOT': 'PF_DOTUSD',
  'AVAX': 'PF_AVAXUSD',
  'MATIC': 'PF_MATICUSD',
  'DOGE': 'PF_DOGEUSD',
  'BNB': 'PF_BNBUSD',
  'UNI': 'PF_UNIUSD',
  'ATOM': 'PF_ATOMUSD',
  'ARB': 'PF_ARBUSD',
  'OP': 'PF_OPUSD',
};

export const SPOT_PAIRS: Record<string, string> = {
  'BTC': 'XXBTZUSD',
  'ETH': 'XETHZUSD',
  'SOL': 'SOLUSD',
  'XRP': 'XXRPZUSD',
  'LINK': 'LINKUSD',
  'LTC': 'XLTCZUSD',
  'ADA': 'ADAUSD',
  'DOT': 'DOTUSD',
  'AVAX': 'AVAXUSD',
  'MATIC': 'MATICUSD',
  'DOGE': 'XDGUSD',
  'UNI': 'UNIUSD',
  'ATOM': 'ATOMUSD',
};

export interface FundingRate {
  timestamp: string;
  fundingRate: number;
  relativeFundingRate: number;
}

export interface FundingRateResponse {
  result: string;
  rates: FundingRate[];
}

export interface TickerData {
  symbol: string;
  price: number;
  volume24h: number;
  openInterest: number;
  fundingRate: number;
  nextFundingTime: string;
}

/**
 * Fetch historical funding rates for a symbol
 * FREE - No API key required
 */
export async function getHistoricalFundingRates(symbol: string): Promise<FundingRate[]> {
  const krakenSymbol = FUTURES_SYMBOLS[symbol];
  if (!krakenSymbol) {
    console.warn(`Unknown symbol: ${symbol}`);
    return [];
  }

  try {
    const response = await fetch(
      `${KRAKEN_FUTURES_BASE}/historicalfundingrates?symbol=${krakenSymbol}`,
      { 
        next: { revalidate: 300 }, // Cache for 5 minutes
        headers: { 'Accept': 'application/json' }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: FundingRateResponse = await response.json();
    
    if (data.result === 'success') {
      return data.rates || [];
    }
    
    return [];
  } catch (error) {
    console.error(`Failed to fetch funding rates for ${symbol}:`, error);
    return [];
  }
}

/**
 * Fetch current tickers for all futures
 * FREE - No API key required
 */
export async function getTickers(): Promise<Record<string, TickerData>> {
  try {
    const response = await fetch(`${KRAKEN_FUTURES_BASE}/tickers`, {
      next: { revalidate: 10 }, // Cache for 10 seconds
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const tickers: Record<string, TickerData> = {};

    if (data.result === 'success' && data.tickers) {
      for (const ticker of data.tickers) {
        // Find our symbol name
        for (const [ourSymbol, krakenSymbol] of Object.entries(FUTURES_SYMBOLS)) {
          if (ticker.symbol === krakenSymbol) {
            tickers[ourSymbol] = {
              symbol: ourSymbol,
              price: ticker.last || ticker.markPrice || 0,
              volume24h: ticker.vol24h || 0,
              openInterest: ticker.openInterest || 0,
              fundingRate: ticker.fundingRate || 0,
              nextFundingTime: ticker.nextFundingRateTime || '',
            };
            break;
          }
        }
      }
    }

    return tickers;
  } catch (error) {
    console.error('Failed to fetch tickers:', error);
    return {};
  }
}

/**
 * Fetch spot prices from Kraken
 * FREE - No API key required
 */
export async function getSpotPrices(symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  
  // Build pairs string
  const pairs = symbols
    .map(s => SPOT_PAIRS[s])
    .filter(Boolean)
    .join(',');

  if (!pairs) return prices;

  try {
    const response = await fetch(
      `${KRAKEN_SPOT_BASE}/Ticker?pair=${pairs}`,
      { next: { revalidate: 10 } }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.result) {
      for (const [pairKey, tickerData] of Object.entries(data.result)) {
        // Find our symbol
        for (const [ourSymbol, krakenPair] of Object.entries(SPOT_PAIRS)) {
          if (pairKey.includes(krakenPair.replace('Z', '')) || pairKey === krakenPair) {
            prices[ourSymbol] = parseFloat((tickerData as any).c[0]);
            break;
          }
        }
      }
    }

    return prices;
  } catch (error) {
    console.error('Failed to fetch spot prices:', error);
    return prices;
  }
}

// ============================================================
// PRIVATE API (Requires API Key)
// ============================================================

interface KrakenCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * Generate authentication headers for private endpoints
 */
function generateAuthHeaders(
  credentials: KrakenCredentials,
  endpoint: string,
  postData: string = ''
): Record<string, string> {
  const nonce = Date.now().toString();
  const message = postData + nonce + endpoint;
  
  const hash = crypto.createHash('sha256').update(message).digest();
  const hmac = crypto.createHmac('sha512', Buffer.from(credentials.apiSecret, 'base64'));
  hmac.update(hash);
  const signature = hmac.digest('base64');

  return {
    'APIKey': credentials.apiKey,
    'Nonce': nonce,
    'Authent': signature,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

/**
 * Get account balances
 * REQUIRES API KEY
 */
export async function getAccountBalance(credentials: KrakenCredentials) {
  const endpoint = '/derivatives/api/v3/accounts';
  const headers = generateAuthHeaders(credentials, endpoint);

  try {
    const response = await fetch(`https://futures.kraken.com${endpoint}`, {
      method: 'GET',
      headers,
    });

    return await response.json();
  } catch (error) {
    console.error('Failed to get account balance:', error);
    throw error;
  }
}

/**
 * Place an order
 * REQUIRES API KEY
 */
export async function placeOrder(
  credentials: KrakenCredentials,
  params: {
    symbol: string;
    side: 'buy' | 'sell';
    size: number;
    orderType: 'lmt' | 'mkt' | 'stp' | 'take_profit';
    limitPrice?: number;
    stopPrice?: number;
    reduceOnly?: boolean;
  }
) {
  const endpoint = '/derivatives/api/v3/sendorder';
  const krakenSymbol = FUTURES_SYMBOLS[params.symbol] || params.symbol;
  
  const postData = new URLSearchParams({
    orderType: params.orderType,
    symbol: krakenSymbol,
    side: params.side,
    size: params.size.toString(),
    ...(params.limitPrice && { limitPrice: params.limitPrice.toString() }),
    ...(params.stopPrice && { stopPrice: params.stopPrice.toString() }),
    ...(params.reduceOnly && { reduceOnly: 'true' }),
  }).toString();

  const headers = generateAuthHeaders(credentials, endpoint, postData);

  try {
    const response = await fetch(`https://futures.kraken.com${endpoint}`, {
      method: 'POST',
      headers,
      body: postData,
    });

    return await response.json();
  } catch (error) {
    console.error('Failed to place order:', error);
    throw error;
  }
}

/**
 * Get open positions
 * REQUIRES API KEY
 */
export async function getOpenPositions(credentials: KrakenCredentials) {
  const endpoint = '/derivatives/api/v3/openpositions';
  const headers = generateAuthHeaders(credentials, endpoint);

  try {
    const response = await fetch(`https://futures.kraken.com${endpoint}`, {
      method: 'GET',
      headers,
    });

    return await response.json();
  } catch (error) {
    console.error('Failed to get open positions:', error);
    throw error;
  }
}

/**
 * Cancel an order
 * REQUIRES API KEY
 */
export async function cancelOrder(credentials: KrakenCredentials, orderId: string) {
  const endpoint = '/derivatives/api/v3/cancelorder';
  const postData = `order_id=${orderId}`;
  const headers = generateAuthHeaders(credentials, endpoint, postData);

  try {
    const response = await fetch(`https://futures.kraken.com${endpoint}`, {
      method: 'POST',
      headers,
      body: postData,
    });

    return await response.json();
  } catch (error) {
    console.error('Failed to cancel order:', error);
    throw error;
  }
}
