# AI Income Lab — Phase 1

Discover, validate, build, publish, measure, earn, and scale halal online income opportunities.

> **Important:** all dashboard numbers are **SAMPLE DATA / AI ESTIMATE** unless explicitly connected
> to a live integration. Do not treat them as market research, traffic, sales, or revenue.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- Vercel-compatible architecture
- No database yet; Phase 1 uses typed in-repo sample data

## Getting started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Project structure

- `src/app` — routes: dashboard, opportunities (+ detail), products, experiments, revenue, agents, settings
- `src/components` — `AppShell` layout/navigation and small `ui` primitives
- `src/lib/types.ts` — opportunity/product/experiment/revenue/agent models
- `src/lib/scoring.ts` — transparent weighted scoring engine
- `src/lib/data` — clearly labeled SAMPLE DATA only

## Scoring weights

Demand 20%, Commercial Intent 20%, Competition Opportunity 15%, Startup Cost 10%,
Automation 10%, Differentiation 10%, Monetization Strength 10%, Halal/Compliance 5%.

`NOT_ALLOWED` items never receive a normal positive recommendation.
`REVIEW_REQUIRED` always needs human review; automated screening is not a religious ruling.
