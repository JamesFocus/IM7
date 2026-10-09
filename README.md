# Auction Market — Node.js MVP

A responsive auction marketplace prototype with:
- Community feed with item cards, categories, search, auction timers, seller labels
- User item listings, comments, and USD bidding
- Demo account selector and a local wallet ledger
- Auction close/winner calculation and explicit **demo-only** settlement
- PayPal Orders API scaffolding for wallet refills
- JSON file persistence in `data/db.json`

## Quick preview

Requirements: Node.js 18+ and npm.

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`. The project seeds two demo accounts:
- Demo User — starts with $250 demo wallet balance
- Mina Seller — starts with $0 demo wallet balance

Switch accounts from the top-right selector. Try posting an item, adding comments, and bidding. The sample listing ends in about five hours; for a quick test you can create a listing with a one-hour duration. The current demo settlement transfers balances only inside the local JSON ledger and **does not move real money**.

## PayPal setup

1. Create a PayPal Developer account and a sandbox REST app.
2. Copy the sandbox Client ID and Secret into `.env`.
3. Set `PAYPAL_ENV=sandbox`, `DEMO_MODE=false`, and `BASE_URL` to the public HTTPS URL used for testing.
4. Restart the server. The refill button will redirect to PayPal approval.
5. The browser-side return path is configured for the UI; for a production-grade checkout, implement a dedicated return page that reads PayPal's `token` query parameter and calls `POST /api/paypal/capture-order` with that order ID. Capture is intentionally server-side and credits the wallet only after PayPal confirms a completed USD capture.

The demo fallback never credits a wallet. This prevents a fake preview order from being mistaken for a real payment.

## Important real-money limitations

This is a runnable MVP, not a production financial marketplace.

- **PayPal does not automatically return a buyer's precise physical location.** Payer ID/email/name may be returned depending on the transaction and account settings. A shipping address is available only when the order flow collects/provides one and PayPal returns it. Do not treat IP-derived location as a verified address.
- **PayPal wallet refills are not the same as marketplace seller payouts.** To pay sellers through PayPal, use an eligible PayPal Commerce Platform marketplace/partner setup with seller onboarding and the appropriate partner-fee/disbursement flow. This starter does not send payouts to external PayPal accounts.
- The current auction settlement is **demo-only**. Before real launch, implement legally reviewed marketplace payment flows, verified payment webhooks, payout eligibility checks, refunds/disputes, KYC/AML and sanctions controls as applicable, tax handling, audit logs, and robust authorization.
- Demo user selection is not authentication. Add real accounts, secure sessions, password reset, rate limits, CSRF protections where relevant, input moderation, and role/ownership checks before deploying publicly.
- JSON persistence is suitable for a local preview only. Use PostgreSQL or another production database with transactions and locking before multiple users can bid concurrently.
- The current bid endpoint checks that the bidder's wallet has enough funds but does not reserve funds. Do not use this implementation for real-money auctions until reservation, anti-sniping rules, bid locking, payment guarantees, and settlement are implemented.

## Deploying

Deploy to a Node.js host that supports persistent environment variables. If using a platform with an ephemeral filesystem, the JSON database may reset on redeploy; replace it with a managed database before production. Use HTTPS and never commit `.env`.

## Main routes

- `GET /api/items` — feed
- `POST /api/items` — create listing
- `POST /api/items/:id/bids` — place bid
- `POST /api/items/:id/comments` — add comment
- `GET /api/me` and `GET /api/history` — current demo user's wallet/activity
- `POST /api/paypal/create-order` — create PayPal refill order
- `POST /api/paypal/capture-order` — capture a PayPal order and credit wallet
- `POST /api/auctions/settle` — explicit demo ledger settlement only
