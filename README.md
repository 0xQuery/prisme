# prisme

`prisme` is an AI-first service landing site with:
- Layer 1 public preview (no AI calls)
- Layer 2 invite-gated live consult
- Deterministic fixed-fee quote engine
- Mars/prism animated background that freezes 1 second after first chat interaction
- Cost controls (3 turns max, daily AI budget fallback)

## Stack
- Next.js App Router + TypeScript
- Server routes under `src/app/api/*`
- WebGL shader background in `src/components/mars-prism-canvas.tsx`
- Quote engine in `src/lib/quote-engine.ts`

## Quick Start
1. Install deps:
   - `npm install`
2. Configure env:
   - `cp .env.example .env.local`
3. Start dev server:
   - `npm run dev`
4. Open:
   - [http://localhost:3000](http://localhost:3000)

Default invite code (if unchanged): `PRISME-DEMO`.

## API Endpoints
- `GET /api/consult/config`: public-safe config for UI.
- `POST /api/invite/verify`: checks invite code and creates consult session token.
- `POST /api/consult/start`: initializes assistant opening prompt.
- `POST /api/consult/turn`: consumes one turn, optionally calls Gemini, returns quote.
- `POST /api/quote/calculate`: deterministic quote calculation API.
- `POST /api/analytics/event`: event ingestion endpoint.

## Pricing Policy (Implemented)
- Capacity model: `NORMAL`, `BUSY`, `AT_CAPACITY`.
- Standard surcharge:
  - `NORMAL +0%`
  - `BUSY +10%`
  - `AT_CAPACITY +20%`
- Rush mode:
  - `BUSY +30%`
  - `AT_CAPACITY +50%`
  - Rush unavailable in `NORMAL` unless `ALLOW_RUSH_IN_NORMAL=true`
- Rush replaces standard capacity surcharge (no stacking).
- Global uplift cap: `+50%`.
- Quote validity: 7 days.

## Cost Guardrails
- No model calls before invite gate is passed.
- Max 3 consult turns per session.
- Daily AI budget cap enforced with fallback to capture mode.
- Invite/session/IP rate limits on API routes.

## Commands
- `npm run dev`: run local dev server.
- `npm run lint`: run eslint checks.
- `npm run build`: production build.

## Notes
- Turnstile verification is optional and only applied if a token is supplied with `/api/invite/verify`.
- Session, rate-limit, and budget stores are in-memory for v1 and reset on server restart.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
