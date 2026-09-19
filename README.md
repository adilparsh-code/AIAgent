# AI Income Lab — Phase 2

Discover, validate, build, publish, measure, earn, and scale halal online income opportunities.

> **Important:** all dashboard numbers are **SAMPLE DATA / AI ESTIMATE** unless they were created by you
> and stored in PostgreSQL. Do not treat sample rows as market research, traffic, sales, or revenue.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- PostgreSQL + Prisma persistence
- Vercel-compatible architecture: UI → API/Server → Repository → Prisma → PostgreSQL

Prisma is server-only. Client components never import `@prisma/client` or `DATABASE_URL`.

## Getting started

```bash
# Install dependencies and generate the Prisma client
npm install

# Copy the example env file and fill in your own values
cp .env.example .env
```

Set `DATABASE_URL` to your PostgreSQL connection string. Never commit `.env` or real credentials.
Never expose the database URL as `NEXT_PUBLIC_DATABASE_URL`.

```bash
# Apply migrations
npx prisma migrate deploy

# Generate the client (also runs on npm install)
npx prisma generate

# Start the app
npm run dev
```

Open `http://localhost:3000`.

Without `DATABASE_URL`, the UI still shows in-repo sample/demo data. Create/update/delete and live
research persistence require PostgreSQL.

## Checks

```bash
npm ci
npx prisma generate
npm run typecheck
npm test
npm run build
```

## Data model

- Sample/demo data lives in `src/lib/data` and is labeled in the UI. It is not mixed into user rows.
- User-created opportunities, products, experiments, revenue, and agents are stored in PostgreSQL.
- `/api/research` persists `ResearchRun`, `ResearchQuery`, `Evidence`, and `ResearchFinding` history.
- Money fields use Prisma `Decimal`.
- Sample rows cannot be deleted.

## Project structure

- `prisma/schema.prisma` — PostgreSQL schema, relations, indexes
- `prisma/migrations` — SQL migrations
- `src/lib/db.ts` — server-only Prisma client
- `src/lib/server/repositories` — Prisma repositories
- `src/lib/repositories` — client repositories that call `/api/*`
- `src/app` — routes: dashboard, opportunities, products, experiments, revenue, agents, settings
- `src/lib/data` — clearly labeled SAMPLE DATA only

## Scoring weights

Demand 20%, Commercial Intent 20%, Competition Opportunity 15%, Startup Cost 10%,
Automation 10%, Differentiation 10%, Monetization Strength 10%, Halal/Compliance 5%.

`NOT_ALLOWED` items never receive a normal positive recommendation.
`REVIEW_REQUIRED` always needs human review; automated screening is not a religious ruling.
