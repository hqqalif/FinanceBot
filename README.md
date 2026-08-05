# FinanceBot

WhatsApp expense tracking bot backed by PostgreSQL, using Meta's official WhatsApp Cloud API. The first runnable slice records expenses from the required `spending name, category, price[, CURRENCY]` format, stores opening balances, and returns balances per currency.

## Local setup

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Set up a Meta WhatsApp Cloud API app and fill in `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and `WHATSAPP_APP_SECRET` in `.env` (see "Meta Cloud API setup" below).
3. Start the supporting services with `docker compose up -d postgres redis`.
4. Run `npm install` and `npm start`.
5. Expose the webhook publicly over HTTPS (e.g. with `ngrok http 3000` for local testing) and register that URL + your `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in the Meta App Dashboard's WhatsApp > Configuration webhook settings, subscribed to the `messages` field.

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

`/help` displays the available commands.

## Meta Cloud API setup

1. Create/select an app at [developers.facebook.com](https://developers.facebook.com/apps) with the WhatsApp product added.
2. Under WhatsApp > API Setup, note the temporary access token, the test phone number, and its Phone Number ID.
3. Under App Settings > Basic, copy the **App Secret** into `WHATSAPP_APP_SECRET`.
4. Pick any random string for `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (you choose it - Meta just echoes it back on verification).
5. Under WhatsApp > Configuration, set the webhook URL to `https://<your-domain>/webhook` and the verify token from step 4, then subscribe to the `messages` field.
6. For production: add a real phone number (WhatsApp > API Setup > "Add phone number"), verify the business, and generate a permanent token via System Users (Business Settings > Users > System Users) with the `whatsapp_business_messaging` permission instead of the 24h temporary token.

## Validation

Run `npm test`, `npm run build`, and `docker compose config --quiet`.

## Next implementation slices

- Receipt upload, private object storage, OCR extraction, and confirmation workflow.
- Queued PDF reports sent back through WhatsApp.
- Managed PostgreSQL/object storage, encrypted session storage, backup/retention jobs.
