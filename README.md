# FinanceBot

WhatsApp expense tracking bot backed by PostgreSQL. The first runnable slice records expenses from the required `spending name, category, price[, CURRENCY]` format, stores opening balances, and returns balances per currency.

## Local setup

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Start the supporting services with `docker compose up -d postgres redis`.
3. Run `npm install` and `npm start`.
4. Scan the Baileys QR code with the dedicated WhatsApp account that will run the bot.

There is no default currency. Open a wallet first, then record spending against it:

```text
/opening 100000 IDR
Lunch, Food, 45000
/balance
```

If you have more than one wallet open, plain spending messages are ambiguous - include the currency explicitly:

```text
/opening 100000 IDR
/opening 100 AUD
Coffee, Drinks, 5.50, AUD
```

`/help` displays the available commands. Use a dedicated WhatsApp account for the Baileys prototype; move to the Meta Cloud API before offering the service publicly.

## Validation

Run `npm test`, `npm run build`, and `docker compose config --quiet`.

## Next implementation slices

- Receipt upload, private object storage, OCR extraction, and confirmation workflow.
- Queued PDF reports sent back through WhatsApp.
- Managed PostgreSQL/object storage, encrypted session storage, backup/retention jobs, and a Meta Cloud API provider for production.