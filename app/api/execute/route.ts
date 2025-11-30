import { NextRequest, NextResponse } from 'next/server';
import { placeOrder, getAccountBalance, FUTURES_SYMBOLS } from '@/lib/kraken';

/**
 * POST /api/execute
 * 
 * Execute a trade on Kraken Futures
 * REQUIRES API KEYS set in environment variables
 * 
 * Body:
 *   - symbol: string (e.g., 'BTC')
 *   - side: 'buy' | 'sell'
 *   - size: number (contract size)
 *   - orderType: 'mkt' | 'lmt'
 *   - limitPrice?: number (required for limit orders)
 *   - stopLoss?: number
 *   - takeProfit?: number
 */
export async function POST(request: NextRequest) {
  try {
    // Check for API credentials
    const apiKey = process.env.KRAKEN_API_KEY;
    const apiSecret = process.env.KRAKEN_API_SECRET;

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Trading not configured. Set KRAKEN_API_KEY and KRAKEN_API_SECRET in environment variables.',
          mode: 'paper' 
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { symbol, side, size, orderType, limitPrice, stopLoss, takeProfit } = body;

    // Validate required fields
    if (!symbol || !side || !size || !orderType) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: symbol, side, size, orderType' },
        { status: 400 }
      );
    }

    // Validate symbol
    if (!FUTURES_SYMBOLS[symbol]) {
      return NextResponse.json(
        { success: false, error: `Invalid symbol: ${symbol}` },
        { status: 400 }
      );
    }

    // Validate side
    if (!['buy', 'sell'].includes(side)) {
      return NextResponse.json(
        { success: false, error: 'Side must be "buy" or "sell"' },
        { status: 400 }
      );
    }

    const credentials = { apiKey, apiSecret };

    // Check account balance first
    const balanceResponse = await getAccountBalance(credentials);
    if (balanceResponse.result !== 'success') {
      return NextResponse.json(
        { success: false, error: 'Failed to verify account balance', details: balanceResponse },
        { status: 400 }
      );
    }

    // Place main order
    const orderResponse = await placeOrder(credentials, {
      symbol,
      side: side as 'buy' | 'sell',
      size,
      orderType: orderType as 'mkt' | 'lmt',
      limitPrice,
    });

    if (orderResponse.result !== 'success') {
      return NextResponse.json(
        { success: false, error: 'Order placement failed', details: orderResponse },
        { status: 400 }
      );
    }

    const orderId = orderResponse.sendStatus?.order_id;

    // Place stop loss if specified
    let stopLossOrder = null;
    if (stopLoss && orderId) {
      const stopSide = side === 'buy' ? 'sell' : 'buy';
      stopLossOrder = await placeOrder(credentials, {
        symbol,
        side: stopSide,
        size,
        orderType: 'stp',
        stopPrice: stopLoss,
        reduceOnly: true,
      });
    }

    // Place take profit if specified
    let takeProfitOrder = null;
    if (takeProfit && orderId) {
      const tpSide = side === 'buy' ? 'sell' : 'buy';
      takeProfitOrder = await placeOrder(credentials, {
        symbol,
        side: tpSide,
        size,
        orderType: 'take_profit',
        limitPrice: takeProfit,
        reduceOnly: true,
      });
    }

    return NextResponse.json({
      success: true,
      order: {
        id: orderId,
        symbol,
        side,
        size,
        type: orderType,
        status: orderResponse.sendStatus?.status,
      },
      stopLoss: stopLossOrder?.result === 'success' ? stopLossOrder.sendStatus : null,
      takeProfit: takeProfitOrder?.result === 'success' ? takeProfitOrder.sendStatus : null,
    });
  } catch (error) {
    console.error('Execute API error:', error);
    return NextResponse.json(
      { success: false, error: 'Order execution failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/execute
 * 
 * Check if trading is enabled (API keys configured)
 */
export async function GET() {
  const apiKey = process.env.KRAKEN_API_KEY;
  const apiSecret = process.env.KRAKEN_API_SECRET;

  const isConfigured = Boolean(apiKey && apiSecret);

  return NextResponse.json({
    tradingEnabled: isConfigured,
    mode: isConfigured ? 'live' : 'paper',
    message: isConfigured 
      ? 'Trading is enabled with Kraken API' 
      : 'Trading not configured. Running in paper mode. Set KRAKEN_API_KEY and KRAKEN_API_SECRET to enable live trading.',
  });
}
