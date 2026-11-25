# Janda marketing bot API

Any bot (a Claude agent, n8n, Zapier, Make, a script) can work the Janda CRM through this API.

**Auth:** send `Authorization: Bearer <BOT_API_KEY>` on every request. Base path: `/api/bot/`.

## Ground rules the server enforces
- The bot can **propose** campaigns, but only Alba can **approve** them in `/admin → Campañas`.
- The bot can mark a campaign `enviada` (sent) only after Alba has approved it. If the bot edits an approved campaign, it goes back to draft.
- Only message people with `marketingConsent: true`. Use `?consent=true` and the campaign `audience` endpoint, which applies it for you.
- The bot cannot delete contacts or change products.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `stats` | Totals: contacts, subscribers, open inquiries, pipeline value |
| GET | `contacts?consent=true&tag=renta&stage=nuevo&since=2026-11-01&q=ana` | Find contacts (all filters optional) |
| GET | `contacts?format=csv` | Same, as CSV |
| POST | `contacts` | Create or merge a contact `{name, email, phone, tags[], marketingConsent}` |
| GET | `contacts/:id` | One contact with their inquiries and activity history |
| PATCH | `contacts/:id` | Update `{name, stage, tags[], notes, marketingConsent}` |
| POST | `contacts/:id/activities` | Log what the bot did `{type: "email"\|"whatsapp"\|"message"\|"note", summary, channel}`. It shows in Alba's timeline |
| GET | `inquiries?status=nuevo` | Orders, rentals, wholesale requests, and messages, each with its contact |
| PATCH | `inquiries/:id` | `{status: "nuevo"\|"respondido"\|"cerrado"\|"perdido"}` |
| GET | `products` | Full catalog, including stock |
| GET | `campaigns` | All campaigns |
| POST | `campaigns` | Propose a draft `{name, channel: "email"\|"whatsapp"\|"instagram", audience: {tag, stage}, subject, body}` |
| PATCH | `campaigns/:id` | Edit the draft, or `{status: "enviada"}` after approval |
| GET | `campaigns/:id/audience` | The exact consenting contacts this campaign targets |

Contact stages: `nuevo`, `en_conversacion`, `cliente`, `perdido`.
Inquiry types: `pedido` (web order), `renta`, `mayoreo`, `contacto`.

## Real-time events (webhook)
If `WEBHOOK_URL` is set, the server POSTs JSON to it right away:
- `inquiry.created`: `{ inquiry, contact }`, for a new order or request
- `contact.subscribed`: `{ contact }`, for someone who joined Club Janda

Example: the bot receives `inquiry.created` of type `renta`, sends a WhatsApp reply, logs it with `POST contacts/:id/activities`, then sets the inquiry to `respondido`.

## Weekly playbook for the bot
1. `GET inquiries?status=nuevo` and follow up on anything older than 24 h.
2. `GET contacts?consent=true&stage=nuevo&since=<7 days ago>` and send a welcome to new Club members.
3. `GET products` and propose a campaign about new or low-stock pieces with `POST campaigns`.
4. Wait for Alba's approval, send it to `GET campaigns/:id/audience`, log each send, then `PATCH status: "enviada"`.

## Example
```bash
curl -H "Authorization: Bearer $BOT_API_KEY" "https://YOUR-DOMAIN/api/bot/contacts?consent=true&tag=newsletter"
```
