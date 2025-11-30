# Kraken Funding Rate Trader

A Next.js application that monitors crypto funding rates on Kraken Futures and generates trading signals based on mean reversion strategy.

## Features

- **Real-time funding rate analysis** from Kraken Futures API
- **Automated signal generation** based on statistical extremes (Z-score)
- **Multiple risk profiles** (LOW, MEDIUM, HIGH, ULTRA)
- **Paper trading mode** for practice without real money
- **Live trading support** when API keys are configured
- **Progress tracking** towards £100k goal

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo>
cd kraken-trading-app
npm install
```

### 2. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 3. Deploy to Vercel

#### Option A: Via Vercel CLI

```bash
npm i -g vercel
vercel
```

#### Option B: Via GitHub

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Click "Import Project"
4. Select your GitHub repo
5. Click "Deploy"

## Enabling Live Trading

By default, the app runs in **paper trading mode**. To enable live trading:

### 1. Get Kraken Futures API Keys

1. Go to [futures.kraken.com/trade/settings/api](https://futures.kraken.com/trade/settings/api)
2. Create a new API key
3. Enable permissions:
   - ✅ Read (required)
   - ✅ Trade (required for live trading)
   - ❌ Withdraw (NOT recommended)
4. Whitelist your Vercel deployment IP (or allow all for testing)

### 2. Add Environment Variables in Vercel

1. Go to your Vercel project dashboard
2. Click "Settings" → "Environment Variables"
3. Add:
   - `KRAKEN_API_KEY` = your API key
   - `KRAKEN_API_SECRET` = your API secret
4. Redeploy the app

### 3. Verify Connection

The app will show "Live Trading Enabled" in green if configured correctly.

## Strategy Overview

### Signal Generation

The system generates signals based on funding rate Z-scores:

| Z-Score | Signal | Meaning |
|---------|--------|---------|
| ≥ 3.0 + 5 confirmations | ULTRA SHORT | Extreme long leverage, expect crash |
| ≥ 2.5 + 4 confirmations | STRONG SHORT | Heavy long leverage |
| ≥ 2.0 + 3 confirmations | SHORT | Above average long leverage |
| -2.0 to +2.0 | NEUTRAL | Market balanced |
| ≤ -2.0 + 3 confirmations | LONG | Above average short leverage |
| ≤ -2.5 + 4 confirmations | STRONG LONG | Heavy short leverage |
| ≤ -3.0 + 5 confirmations | ULTRA LONG | Extreme short leverage, expect bounce |

### Confirmations

Multiple factors increase confidence:
- Z-score thresholds (1.8, 2.0, 2.5, 3.0)
- Funding rate trend reversal
- Historical extreme proximity
- Volume/OI changes (when available)

### Risk Profiles

| Mode | Risk/Trade | Leverage | Best For |
|------|-----------|----------|----------|
| LOW | 2% | 3x | Beginners, conservative |
| MEDIUM | 3% | 5x | Balanced approach |
| HIGH | 5% | 7x | Experienced traders |
| ULTRA | 8% | 10x | High risk tolerance |

## API Routes

### GET /api/funding

Fetches funding rate data and analysis for all supported assets.

**Response:**
```json
{
  "success": true,
  "timestamp": "2024-01-15T12:00:00Z",
  "data": [
    {
      "symbol": "BTC",
      "price": 97500,
      "zScore": 2.5,
      "signal": "STRONG_SHORT",
      "confirmations": 4,
      "edgeScore": 75,
      "winProbability": 0.65
    }
  ]
}
```

### POST /api/execute

Execute a trade (requires API keys).

**Body:**
```json
{
  "symbol": "BTC",
  "side": "sell",
  "size": 0.1,
  "orderType": "mkt"
}
```

### GET /api/execute

Check if live trading is enabled.

## Supported Assets

BTC, ETH, SOL, XRP, LINK, LTC, ADA, DOT, AVAX, MATIC, DOGE, UNI, ATOM, ARB, OP

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **API**: Kraken Futures REST API
- **Deployment**: Vercel

## Disclaimer

⚠️ **This is for educational purposes only. Not financial advice.**

Trading cryptocurrencies involves significant risk. Past performance does not guarantee future results. Only trade with money you can afford to lose.

## License

MIT
