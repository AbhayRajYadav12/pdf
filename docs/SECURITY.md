# Security

Controls that the code implements:

- Better Auth email and password, with the session in an httpOnly cookie. Secure cookies are enabled when `NODE_ENV=production`.
- Application routes are `/api/auth/register`, `/login`, `/logout`, and `/me`. Better Auth's own handler is not mounted on those paths.
- Workspace roles are `admin` and `member` in `memberships`. The creator of a workspace is an admin. Document and chat queries require a membership.
- Vector search includes the workspace and the allowed document versions in the filter, and the process checks the payload afterward.
- PDF downloads require membership. Storage keys are server-generated. The local store rejects `..` and absolute keys.
- Production mutations require an `Origin` of `APP_ORIGIN` or `BETTER_AUTH_URL`. Development and test allow a missing Origin so local test clients can call the API.
- Helmet, a CORS allowlist, a 1 MB JSON limit, and rate limits on auth (30 per 15 minutes), upload (30 per hour), and chat (60 per hour).
- Logs go through pino and redact cookies, passwords, tokens, and API keys. Full PDF text is not logged.
- Audit events store the actor, action, workspace, and target id.

This build does not claim a certification, a penetration test, or a compliance program.

Additional production work is described in [DEPLOYMENT.md](DEPLOYMENT.md): TLS, a private object store, network isolation, and backups. The local volume is not that object store.
