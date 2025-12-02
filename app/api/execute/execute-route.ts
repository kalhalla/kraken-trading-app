// API Route: /api/execute
// Paper trading execution - no real trades until API keys are configured

import { NextRequest, NextResponse } from 'next/server';
import { FUTURES_SYMBOLS } from '@/lib/kraken';

export const dynamic = 'force-dynamic';

interface TradeRequest {
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  leverage?: number;
}

/**
 * POST /api/execute
 * Execute a trade (paper trading only for now)
 */
export async function POST(request: NextRequest) {
  try {
    const body: TradeRequest = await request.json();
    const { symbol, side, size, leverage = 1 } = body;

    // Validate symbol
    if (!FUTURES_SYMBOLS[symbol.toUpperCase()]) {
      return NextResponse.json(
        { success: false, error: `Unknown symbol: ${symbol}` },
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

    // Validate size
    if (typeof size !== 'number' || size <= 0) {
      return NextResponse.json(
        { success: false, error: 'Size must be a positive number' },
        { status: 400 }
      );
    }

    // Check if live trading is enabled (API keys present)
    const hasApiKeys = process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET;

    if (hasApiKeys) {
      // TODO: Implement real Kraken Futures order execution
      // This requires authenticated API calls with HMAC signatures
      return NextResponse.json({
        success: false,
        error: 'Live trading not yet implemented. Remove API keys to use paper trading.',
        mode: 'live',
      });
    }

    // Paper trading - simulate the trade
    const simulatedOrderId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    return NextResponse.json({
      success: true,
      mode: 'paper',
      order: {
        orderId: simulatedOrderId,
        symbol: FUTURES_SYMBOLS[symbol.toUpperCase()],
        side,
        size,
        leverage,
        status: 'filled',
        timestamp: new Date().toISOString(),
      },
      message: 'Paper trade executed successfully',
    });

  } catch (error) {
    console.error('Execute error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/execute
 * Get trading mode status
 */
export async function GET() {
  const hasApiKeys = process.env.KRAKEN_API_KEY && process.env.KRAKEN_API_SECRET;
  
  return NextResponse.json({
    mode: hasApiKeys ? 'live' : 'paper',
    tradingEnabled: true,
    message: hasApiKeys 
      ? 'Live trading mode - real orders will be placed'
      : 'Paper trading mode - no real orders',
  });
}
