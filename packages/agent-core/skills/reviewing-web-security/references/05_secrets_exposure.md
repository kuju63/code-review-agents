# 05 Secrets Exposure (Underestimating Where Data Can Reach)

## Contents

- [Root cause](#root-cause)
- [Hardcoded secrets](#hardcoded-secrets-code-is-read-more-widely-than-you-think)
- [Secrets in logs](#secrets-in-logs-who-actually-has-access-to-logs)
- [Error responses](#error-responses-development-detail-leaking-to-production-users)
- [Questions to use during review](#questions-to-use-during-review)
- [References](#references)

## Root Cause

Secrets leak through paths that developers assumed were safe.

An API key written in code was "just for getting it working locally." Request logging was "just for debugging." Detailed error messages were "just for developer efficiency." In each case, the assumption was "this place is safe" — and that assumption was never verified.

In a PR review, the question to hold while reading is: **"Where can this value ultimately reach?"** Code, logs, responses, and bundles are all potential exits.

---

## Hardcoded Secrets: "Code Is Read More Widely Than You Think"

### Mechanism of impact

Developers who write API keys into code typically assume only a few people in their local environment or team will see it. In practice:

- Git history persists after deletion (`git log`, `git reflog`, GitHub's history API)
- A `git push` to a public repo triggers GitHub's secret scanner in near-real time
- Forks, mirrors, and backups create copies
- CI/CD build logs may echo environment variables

**Once a secret appears in a public Git repository, "I deleted it" does not make it safe.** It may already be indexed or captured. The only recovery is rotating the credential with the affected service.

### Line of reasoning in code

Don't just scan for literal API key strings — obfuscated or encoded forms appear too:

```javascript
// Obvious case
const API_KEY = 'sk-proj-abcdef123456';

// Easy to overlook 1: embedded in a config object
const config = {
  database: { password: 'MyP@ssw0rd!' },
  stripe: { key: 'sk_live_...' }
};

// Easy to overlook 2: Base64 "obscured"
const token = Buffer.from('user:password').toString('base64');
// → 'dXNlcjpwYXNzd29yZA==' → trivially decoded

// Easy to overlook 3: test fixtures
describe('Payment', () => {
  const stripeKey = 'sk_test_realkey_here';  // even test keys can be real
});
```

**Frontend bundle inclusion** is particularly hard to notice. Frameworks like Next.js and Vite use env var prefixes to control what gets bundled client-side, but the rules are not universally understood:

```javascript
// Next.js
NEXT_PUBLIC_API_URL = 'https://api.example.com'  // exposed to client (intended)
DATABASE_URL = 'postgres://...'                    // server only (intended)
API_SECRET_KEY = 'sk-...'                          // server only in .env, but...
// ↑ if this is imported in frontend code, it enters the bundle
```

---

## Secrets in Logs: "Who Actually Has Access to Logs?"

### Mechanism of impact

Logs are treated as "debug output," but in practice they flow to:
- CI/CD build logs (broad internal access)
- CloudWatch / Datadog (third-party infrastructure)
- Log aggregation services (multiple teams access them)
- External security teams during incident response

The premise "logs are in a secure place" does not hold. Logging `req.body` wholesale records password fields, credit card numbers, and anything else submitted.

### Line of reasoning in code

Examine what is passed to `logger.*` or `console.*`:

```javascript
// Dangerous
logger.info('Request received', { body: req.body });        // may contain passwords
logger.debug(`User: ${JSON.stringify(user)}`);              // includes passwordHash, tokens
logger.error('Auth failed', error);                         // error.stack may contain DB queries

// Safe
logger.info('Request received', {
  method: req.method,
  path: req.path,
  userId: req.user?.id,
  // body is intentionally omitted
});
```

---

## Error Responses: "Development Detail Leaking to Production Users"

### Mechanism of impact

The error detail developers need (stack traces, query strings, internal paths) is exactly what attackers find useful. Stack traces reveal framework versions, file paths, and dependency structure — all useful for planning the next step of an attack.

User enumeration is a commonly overlooked form of information disclosure. "That email address is not registered" tells an attacker which email addresses are registered.

### Line of reasoning in code

Check whether error verbosity is controlled by environment:

```javascript
// Problem: error passes through unfiltered
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message, stack: err.stack });
});

// Better: hide detail in production
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  if (process.env.NODE_ENV === 'production') {
    res.status(500).json({ error: 'Internal server error' });
  } else {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// User enumeration
// Bad: distinguishes existence from credential mismatch
if (!user) return res.status(404).json({ error: 'User not found' });
if (!passwordMatch) return res.status(401).json({ error: 'Wrong password' });

// Good: returns the same message regardless
if (!user || !passwordMatch) return res.status(401).json({ error: 'Invalid credentials' });
```

---

## Questions to Use During Review

1. **Where can this value ultimately reach?** Code, logs, responses, bundles — which apply?
2. **Does frontend code import env vars that should be server-only?** Check framework prefix rules.
3. **Are `req.body` or full user objects being passed to log calls?**
4. **Does the error handler suppress detail in production?**

---

## References

- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Error Handling Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- GitGuardian (commit secret scanning): https://www.gitguardian.com/
