# Qdrant & Redis → PostgreSQL Migration Analysis

_Date: 2026-07-14_

## Question
Are Qdrant and Redis important for the current project, and can we change them to PostgreSQL?

## Short answer
**Yes — both can be replaced with PostgreSQL with low risk.** They are used in a single worker file as an LLM "memory" layer, with no client SDK lock-in.

---

## Where they're actually used

Both Qdrant and Redis are wired into **exactly one code file**:
`callbot/apps/backend/src/analysis-worker.ts` (the post-call analysis worker).

- Not used by the main backend API or the CRM `app/`.
- **No client SDKs** — Qdrant is called via raw `fetch()` (REST API), Redis via a hand-written TCP/RESP socket (`net.createConnection`). So migration surface area is small.

They form a 3-tier "memory" layer feeding the Gemini prompt that generates a call's description:

| Store | Role | What's stored |
|-------|------|---------------|
| **Redis** | Short-term cache | One key per customer: `callbot:customer:{id}:last_analysis`, `SETEX` 14-day TTL. Caching only — no queues, pub/sub, locks, BullMQ. |
| **Qdrant** | "Similar past calls" | Collection `call_memory`, 384-dim cosine vectors, `search` (top-5, `score_threshold: 0.12`) + `upsert`. |
| **Postgres** | Already in the mix | Last 5 calls per customer, via Drizzle. |

### Key code references (`analysis-worker.ts`)
- Qdrant config: lines 19-22 (`QDRANT_URL`, `QDRANT_COLLECTION=call_memory`, `QDRANT_ENABLED`, `vectorSize=384`)
- Vector building (hashed, not ML): `textVector`, `normalizeVector`, `hashToIndex` (lines 42-63)
- `ensureQdrantCollection` lines 125-138; `qdrantSearch` lines 140-160; `qdrantUpsert` lines 162-192
- Redis: `redisUrl` line 18; RESP encode/parse lines 65-121; `redisGet` line 114; `redisSetEx` line 119
- Redis key: `callbot:customer:{customerId}:last_analysis` (line 282), TTL `60*60*24*14` (14 days, line 320)
- Combined 3-tier memory in `analyze()` lines 279-321

---

## Are they important?

**Functionally minor, easily replaceable.** Two details make the swap safe:

1. **Redis is pure cache** — no persistence (docker: `--save "" --appendonly no --maxmemory 96mb --maxmemory-policy allkeys-lru`). Losing it loses nothing durable. The last analysis is *already* stored in Postgres (`calls` table).

2. **Qdrant's vectors are NOT ML embeddings.** They're hand-rolled 384-dim hashed bag-of-words + character-trigram vectors (SHA1 → buckets, L2-normalized). It's lexical similarity, not semantic embeddings — so no semantic quality is lost by moving off Qdrant.

---

## How to move to PostgreSQL

### Redis → trivial
Replace `redisGet`/`redisSetEx` with a small table:
```sql
CREATE TABLE customer_last_analysis (
  customer_id  ... PRIMARY KEY,
  description  text,
  updated_at   timestamptz DEFAULT now()
);
```
Or skip the table entirely and read the latest row from `calls` — the data is already there.

### Qdrant → two options
- **`pgvector` extension** — keep the exact same 384-dim vectors and cosine distance in a `vector(384)` column with an HNSW index. Near 1:1 port of search/upsert. Supported on Postgres 17.
- **Postgres full-text search (`tsvector`)** — since current vectors are just lexical hashing, native FTS gives equal-or-better "similar calls" results with zero extra infra and no vector math. **Recommended** given the current implementation.

---

## Infra impact
Removes two Docker services (`unified-redis`, `unified-qdrant`) from `docker-compose.yml`, simplifying deployment. PostgreSQL (`postgres:17-alpine`) is already the primary datastore:
- Callbot backend: Drizzle ORM (`drizzle-orm/postgres-js`)
- CRM `app/`: raw `pg` pool
- Two logical DBs: `crm_ai` and `callbot`

---

## Caveat
Root `.evolution-env` references Redis (`REDIS_PREFIX_KEY=evolution`) for an **Evolution API / WhatsApp** service — separate from the callbot code. It would keep its own Redis unless that service is also removed.

---

## Open decision
Target for the "similar calls" feature:
- **`pgvector`** — exact behavior preserved
- **native full-text search** — simplest (recommended)
