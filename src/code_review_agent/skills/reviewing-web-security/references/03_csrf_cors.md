# 03 CSRF / CORS (Request Origin and Intent Verification)

## Contents
- Root cause
- CSRF: unintended cross-site requests
- CORS: disabling protection inadvertently
- Thinking about CSRF and CORS together
- Questions to use during review
- References

## Root Cause

CSRF and CORS misconfiguration look like separate problems but share a common root.

**Browsers were not designed to let servers distinguish requests originating from different sites.** Cookies are sent automatically regardless of the request's origin — a legacy design decision. CSRF exploits this behavior; CORS misconfiguration inadvertently disables the browser's same-origin policy that partially compensates for it.

They are two sides of the same coin. CSRF is "a request can be sent from a different origin." CORS misconfiguration is "a response can be read from a different origin." And when CORS is misconfigured, even a correctly-set CSRF token can be read by the attacker before being used.

---

## CSRF: "One Click Makes the User Do Something They Didn't Intend"

### Mechanism of impact

Because browsers automatically attach cookies, a request to a site the user is logged into **can originate from an attacker's site and still arrive as an authenticated request**.

```html
<!-- Placed on any attacker-controlled site -->
<img src="https://bank.example.com/transfer?to=attacker&amount=100000">
<!-- or -->
<form action="https://sns.example.com/posts/delete/42" method="POST">
  <input type="submit" value="Claim your prize">
</form>
```

Impact depends on the application. For banking: unauthorized transfers. For social apps: posts, deletions, follows. For e-commerce: address changes, orders. Any operation the authenticated user can perform is in scope.

### Line of reasoning in code

**Look for CSRF protection on state-changing endpoints.** GET requests are (by design) not state-changing and are out of scope.

```javascript
// Examine POST/PUT/PATCH/DELETE endpoints
// Verify CSRF token validation middleware is applied to them
app.use(csrfMiddleware);  // ← what is the scope of this middleware?

// APIs using Authorization: Bearer <token> instead of cookies
// are not subject to CSRF — the browser won't auto-send a header
// → but they still require correct CORS configuration
```

SameSite cookies are powerful mitigation, but **SameSite=Lax (many browsers' default) still sends cookies on top-level navigations with GET**. If GET requests mutate state (an antipattern, but it exists), Lax is insufficient.

---

## CORS: "Disabling Protection While Thinking You're Adding It"

### Mechanism of impact

CORS configuration errors "add protection" while actually **lifting the browser's same-origin policy protection**. The most dangerous pattern is reflecting the `Origin` header without validation — this achieves what `Access-Control-Allow-Origin: *` cannot (combining wildcard with credentials):

```javascript
// Dangerous: unconditional Origin reflection
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);  // no validation
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});
// Any origin can make credentialed requests and read responses
```

Impact: an attacker-controlled site can read authenticated API responses — personal data, CSRF tokens, secrets — which effectively nullifies CSRF protection.

### Line of reasoning in code

**Look for dynamic Origin setting.** A static `*` is obvious; dynamic reflection is only visible in code.

```javascript
// Pattern 1: reflecting req.headers.origin directly
res.setHeader('Access-Control-Allow-Origin', req.headers.origin);

// Pattern 2: insufficient regex
if (origin.includes('example.com')) {   // 'evil-example.com' passes
  res.setHeader('Access-Control-Allow-Origin', origin);
}

// Pattern 3: loose suffix matching
if (origin.endsWith('.example.com')) {
  // 'attacker.example.com' (if subdomain takeover possible) also passes
  res.setHeader('Access-Control-Allow-Origin', origin);
}

// Safe: strict whitelist
const ALLOWED = new Set(['https://app.example.com', 'https://admin.example.com']);
if (ALLOWED.has(req.headers.origin)) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');  // prevent cache contamination
}
```

A missing `Vary: Origin` header is also a problem: CDNs and reverse proxies may serve a cached response intended for one origin to a different origin.

---

## Thinking About CSRF and CORS Together

```
[Attacker's site] → [Victim's browser] → [Target server]

CSRF succeeds when:
  1. A request can be sent from a cross-origin context (browser allows it)
  2. Credentials (cookies) are automatically attached
  3. The server processes it as a legitimate request

What CORS misconfiguration adds:
  1. Cross-origin request is allowed (preflight passes)
  2. Credentials can be attached AND the response can be read
     (Allow-Credentials: true + reflected Origin)
  3. CSRF token can be read from the response → CSRF protection disabled
```

---

## Questions to Use During Review

1. **For APIs using auth cookies, do state-changing endpoints have CSRF protection** (token, SameSite, custom header)?
2. **Is `Access-Control-Allow-Origin` set dynamically?** If so, is the Origin whitelist strictly validated?
3. **Do `Access-Control-Allow-Credentials: true` and a non-specific Origin setting coexist?**
4. **Bearer token APIs don't need CSRF — but is this assumption correct for this codebase?** (Correct only if cookies are not used; CORS config is still required.)

---

## References

- OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP CORS Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/CORS_Security_Cheat_Sheet.html
- PortSwigger CSRF: https://portswigger.net/web-security/csrf
- PortSwigger CORS: https://portswigger.net/web-security/cors
