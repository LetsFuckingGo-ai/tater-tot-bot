# Janda: storefront + CRM

Website for **Janda Clothing & Accessories** (@janda.clothing): beachwear made in Colombia, sold three ways (venta, renta, mayoreo).

- **`/`**: the store, in Spanish. Collection with filters, quick view, a shopping bag that sends the order to WhatsApp, rental and wholesale request forms, and the Club Janda newsletter.
- **`/admin`**: Alba's CRM. Summary dashboard, requests board, contacts with notes and an activity timeline, a product editor with photo upload, campaign approvals, and settings.
- **`/api/bot/*`**: the API a marketing bot uses. See [`public/BOT.md`](public/BOT.md).

No dependencies and no build step. The data lives in one JSON file (`DATA_DIR/db.json`) and uploaded photos go in `DATA_DIR/uploads/`.

## Run it
```bash
cd janda
npm run dev          # http://localhost:3000, admin password "janda", bot key "dev-bot-key"
npm test
```

## Deploy (Render, Railway, Fly, or any VPS with Node 20+)
1. Start command `node server.js`, root directory `janda`.
2. Set the env vars from `.env.example`: `ADMIN_PASSWORD` (required) and `BOT_API_KEY` (to turn on the bot).
3. **Attach a persistent disk** and point `DATA_DIR` at it (e.g. `/var/data`). Without one, contacts and photos are lost on every redeploy.
4. Put it behind HTTPS. Render, Railway and Fly do this for you.

## First-day checklist for Alba
1. `/admin → Ajustes`: add the WhatsApp number and upload a cover photo.
2. `/admin → Productos`: replace the sample pieces with real ones (photo, price, sizes, stock). Untick "Visible" to hide one.
3. Put the site link in the Instagram bio.

## Notes
- The sample products and the "Nuestra historia" text are placeholders written from the Instagram profile. Edit them to match the real pieces and story.
- Spam protection: honeypot field and per-IP rate limits on public forms.
- Admin sessions last 30 days and are kept in memory, so a restart logs Alba out.
