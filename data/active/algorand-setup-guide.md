# Algorand x402 — Setup Guide

## 1. Get an Algorand wallet (5 min)

**Option A: Pera Wallet (mobile, easiest)**
1. Download Pera Wallet from App Store / Google Play
2. Create new wallet → write down the 25-word seed phrase somewhere safe
3. Your address looks like: `ABC123...XYZ789` (58 chars, starts with letters)
4. Done

**Option B: AlgoKit (desktop, for devs)**
1. Install: https://developer.algorand.org/algokit/
2. Run: `algokit generate wallet my-wallet`
3. Save the generated .env file with your mnemonic
4. Done

**Either way: copy your wallet address somewhere. You'll need it.**

---

## 2. Fund your wallet (5 min)

You need two things on Algorand MainNet:

**a) A tiny bit of ALGO** (for transaction fees — fractions of a cent each)
- Buy ~$1 worth of ALGO on any exchange (Coinbase, Binance, etc.)
- Withdraw to your Algorand address
- Wait 30 seconds for it to arrive

**b) ~$10 USDC** (for the real test payment)
- Buy ~$10 USDC on the same exchange
- Withdraw to your Algorand address
- **IMPORTANT:** When withdrawing, make sure you select the Algorand network (not Ethereum, not Solana)
- The USDC on Algorand is ASA #31566704

**Total cost: ~$11**

---

## 3. Opt into USDC (2 min)

Before you can receive USDC, you need to "opt in" to the USDC asset:

1. Open Pera Wallet
2. Go to your wallet
3. Tap "Add Asset" or "Manage Assets"
4. Search for USDC or enter Asset ID: `31566704`
5. Confirm the opt-in transaction
6. Done — your wallet can now receive USDC

(If using AlgoKit: `algokit asset opt-in --asset-id 31566704 --account my-wallet`)

---

## 4. Get a VPS (5 min)

Any of these work. Cheapest option first:

**Option A: Cloudflare Workers (free tier)**
- Sign up at workers.cloudflare.com
- Free, but limited to Workers runtime (may need adapter)

**Option B: Railway ($5/month)**
- Sign up at railway.app
- Connect GitHub repo, auto-deploys
- Gets a public HTTPS URL automatically

**Option C: any existing server you have**
- If you have a VPS anywhere (Hetzner, DigitalOcean, etc.)
- Just need Node.js 22+ installed and a domain with HTTPS

**Option D: fly.io (free tier)**
- Sign up at fly.io
- `fly launch` deploys your app, gets HTTPS automatically

**You need:**
- A URL like `https://your-app.fly.dev` or `https://your-domain.com`
- It must be HTTPS (not HTTP)
- Node.js 22+ running on it

---

## 5. Copy your wallet address

It looks something like:
```
ABCDEF1234567890GHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF1234
```

Send it to me. I'll plug it into the code.

---

## That's it. While you do those 5 things, I write all the code.

When you come back with:
1. Your wallet address
2. Your VPS URL (or I help you set one up)

...the endpoint is already built. You just deploy and make the first payment.
