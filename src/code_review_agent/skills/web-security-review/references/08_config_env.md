# 08 Configuration & Environment (The Gap Between "Works" and "Works Safely")

## Contents
- Root cause
- Debug features left in production
- Environment separation
- Container configuration
- Questions to use during review
- References

## Root Cause

Configuration problems are among the hardest to find in code review because they require seeing **what is absent**. A single line `DEBUG=true` changes production behavior. Whether leaving an env var unset is "safe" or "dangerous" depends entirely on what the code does with a missing value.

Security and developer experience are always in tension in configuration. Developers want verbose errors, debug endpoints, and relaxed CORS. Production needs the opposite. The recurring failure mode is "development configuration surviving into production."

A second structural problem: **many frameworks and libraries default to developer-friendly, not secure-by-default settings**. Secure configuration requires deliberate action.

---

## Debug Features Left in Production: "Developer Convenience as Attack Surface"

### Mechanism of impact

Debug features are dangerous precisely because they are designed to bypass normal access controls.

- **Stack trace output**: exposes file paths, library versions, internal structure
- **Open admin UIs**: GraphQL Playground, Swagger UI — API schema visible in production without authentication
- **Debug endpoints**: `/debug/config`, `/health/detail` — may return env vars or config values
- **Auth bypass flags**: `SKIP_AUTH=true`, `DEV_USER_ID=1` — if present in production env vars, authentication disappears

### Line of reasoning in code

Check whether env var reads **default to the dangerous side** when unset:

```javascript
// Dangerous: debug is ON when env var is absent
const DEBUG = process.env.DEBUG !== 'false';
// → process.env.DEBUG is undefined → undefined !== 'false' → true

// Safe: explicit opt-in
const DEBUG = process.env.DEBUG === 'true';
// → undefined === 'true' → false

// Dangerous: missing secret still allows the app to run
const SECRET = process.env.JWT_SECRET || '';
// → empty string HMAC secret → anyone can forge valid JWTs

// Safe: refuse to start if secret is absent
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET is required');
```

GraphQL Introspection exposes the full schema and should be disabled in production, but many libraries enable it by default:

```javascript
const server = new ApolloServer({
  introspection: process.env.NODE_ENV !== 'production',  // explicit control
});
```

---

## Environment Separation: "What Does This Remove?"

### Mechanism of impact

`NODE_ENV=production` triggers automatic optimizations and security behaviors in many frameworks. Relying on this as the sole security gate is fragile — a missing env var disables all the protections simultaneously.

### Line of reasoning in code

**Focus on deleted lines in config file diffs.** Additions have visible intent; deletions require thinking about what was lost:

```diff
# docker-compose.yml
environment:
  - NODE_ENV=production
-  - RATE_LIMIT_ENABLED=true   # why was this removed?
  - DATABASE_URL=${DATABASE_URL}

# .env.example
-  ADMIN_EMAIL=admin@example.com  # default removed — what happens if unset?
```

CI/CD secrets leaking into logs:

```yaml
# Dangerous: echoing a secret
- run: echo "API_KEY=${{ secrets.API_KEY }}"

# Dangerous: printing all env vars
- run: printenv

# When secrets are injected as env vars, any code that logs all env vars leaks them
env:
  STRIPE_KEY: ${{ secrets.STRIPE_KEY }}
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

---

## Container Configuration: Principle of Least Privilege

### Mechanism of impact

Running a container as root is problematic not only because root operations are available inside the container, but because **if the container is escaped (via a Docker vulnerability), the attacker's process inherits root-level filesystem access** on the host.

### Line of reasoning in code

When Dockerfiles change, check for the `USER` directive:

```dockerfile
# Problem: no USER directive = runs as root
FROM node:20
WORKDIR /app
COPY . .
RUN npm ci
CMD ["node", "server.js"]

# Better: non-root user
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-slim
RUN useradd -r -u 1001 -g root appuser
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=appuser:root . .
USER appuser
CMD ["node", "server.js"]
```

---

## Questions to Use During Review

1. **When env vars are absent, does the app default to the safe side?** Prefer `=== 'true'` over `!== 'false'`.
2. **Do secret-class env vars have empty-string defaults?** Missing secrets should abort startup.
3. **What was lost in deleted config file lines?**
4. **Are debug features (GraphQL Playground, verbose errors, debug endpoints) disabled by production env vars?**

---

## References

- OWASP Security Misconfiguration (A02:2025): https://owasp.org/Top10/2025/A02_2025-Security_Misconfiguration/
- OWASP Infrastructure as Code Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Infrastructure_as_Code_Security_Cheat_Sheet.html
- Docker Security Best Practices: https://docs.docker.com/develop/security-best-practices/
- GitHub Actions Security Hardening: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
