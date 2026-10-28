# Deployment

Development binds MongoDB, Redis, and Qdrant to `127.0.0.1` in Compose so they are not published on other interfaces. The API and web ports are also bound to localhost.

```bash
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
export GEMINI_API_KEY="your-key"
docker compose up --build
```

Open `http://localhost:8080`. Nginx proxies `/api` and disables proxy buffering so server-sent events flush. `TRUST_PROXY=true` in that stack because the API sees nginx.

The worker and API share the `files` volume at `/data/documents`. That volume is convenient for a single machine. For more than one machine, replace `LocalObjectStore` with a private object store that keeps the same `put`, `open`, and `delete` operations, and do not make the bucket public. Downloads should continue to pass through the membership check.

Also required outside this repository before a real deployment:

- TLS in front of nginx, and `useSecureCookies` which production already turns on
- a secret manager for `BETTER_AUTH_SECRET` and `GEMINI_API_KEY`
- MongoDB, Redis, and Qdrant reachable only on the private network, with backups and a restore drill
- a larger body limit only if you also raise `MAX_UPLOAD_BYTES`
- the reranker profile only if you accept the model download and CPU cost

`GET /api/ready` should fail the rollout when MongoDB, Qdrant, or a required Redis check is down. `GET /api/health` only shows that the process is up.

Do not set `EMBEDDING_PROVIDER=deterministic`, `GENERATION_PROVIDER=fixture`, `QDRANT_URL=memory`, or `INGESTION_MODE=inline` in production. `loadEnv` rejects those values.
