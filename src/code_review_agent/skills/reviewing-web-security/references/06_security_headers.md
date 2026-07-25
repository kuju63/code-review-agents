# 06 Security Headers & CSP (The Precision of Browser Instructions)

## Contents
- Root cause
- CSP: precision of what not to allow
- Other security headers: problems caused by removal
- Questions to use during review
- References

## Root Cause

Security headers are declarations to the browser: "this site permits only this much." Not setting them is equivalent to declaring "everything is permitted."

CSP's purpose is not to "prevent XSS" — it is to **limit damage if XSS occurs**. If injection prevention (01) is the first line of defense, CSP is the second. The problem is that the gap between a CSP that works and one that merely exists is large. A CSP containing `'unsafe-inline'` provides almost no XSS protection, yet the header is present and the team can say "we have CSP."

The setting's existence matters less than what it actually permits.

---

## CSP: The Precision of "What Not to Allow"

### Mechanism of impact

CSP tells the browser: "this page only loads and executes resources from the sources I specify." If XSS embeds a malicious script, CSP blocks its execution.

The following configurations do not function as XSS protection:

```
// 'unsafe-inline' permits inline scripts
// → <script>alert(1)</script> injected via XSS executes
Content-Security-Policy: script-src 'self' 'unsafe-inline'

// nonce coexists with 'unsafe-inline'
// → depending on the browser, 'unsafe-inline' takes precedence over nonce
Content-Security-Policy: script-src 'nonce-abc123' 'unsafe-inline'
```

`'unsafe-eval'` permits `eval()`, `new Function()`, and `setTimeout(string)`. Some XSS techniques route through eval, making this another effective bypass.

### Line of reasoning in code

**When CSP changes, focus on what was added.** Removing directives (tightening) is generally safe; adding them (relaxing) requires justification.

```diff
# Reading a Nginx diff:
- add_header Content-Security-Policy "script-src 'self';";
+ add_header Content-Security-Policy "script-src 'self' 'unsafe-inline';";
# → Why is 'unsafe-inline' needed? Can nonce/hash-based approach be used instead?

- 'self'
+ *.example.com
# → What subdomains exist under example.com? Is any attacker-controlled?

+ data:
# → data: URIs can be used to carry XSS payloads in some contexts
```

When nonce-based CSP is in use, verify the nonce is unique per request:

```javascript
// Dangerous: static nonce (attacker can know it in advance)
res.setHeader('Content-Security-Policy', "script-src 'nonce-fixedvalue123'");
// → <script nonce="fixedvalue123">malicious</script> executes

// Safe: random nonce per request
const nonce = crypto.randomBytes(16).toString('base64');
res.setHeader('Content-Security-Policy', `script-src 'nonce-${nonce}'`);
```

---

## Other Security Headers: Problems Caused by Removal

### Mechanism of impact

Security header problems almost always arise from headers being absent or removed, not misconfigured. In PR review, the question is: **have any headers been deleted or weakened?**

**Removing HSTS is especially dangerous:**
- Once set, browsers cache the HSTS directive and upgrade all HTTP connections to HTTPS automatically
- Changing to `max-age=0` or removing it clears this cache
- The site can subsequently be reached over HTTP, opening the door to man-in-the-middle attacks

**Removing X-Frame-Options:**
- Without this header, the site can be embedded in an `<iframe>`
- Enables clickjacking: a transparent iframe trick causes users to click unintended controls

### Line of reasoning in code

In Nginx / Apache / Express (helmet) diffs, look for deleted lines, commented-out lines, or value changes:

```diff
- add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
+ add_header Strict-Transport-Security "max-age=0";
# → Why is HSTS being disabled? This removes HTTPS enforcement.

- app.use(helmet());
+ app.use(helmet({
+   contentSecurityPolicy: false,
# → Why is CSP being disabled? What specific incompatibility requires this?
+ }));
```

---

## Questions to Use During Review

1. **What does each added CSP directive permit?** Does `'unsafe-inline'` or `'unsafe-eval'` appear?
2. **If nonce-based CSP is in use, is a different nonce generated per request?**
3. **Has HSTS been deleted or weakened?** `max-age=0` is effectively disabling HTTPS enforcement.
4. **In security header configuration files, are there deleted lines?**

---

## References

- OWASP Secure Headers Project: https://owasp.org/www-project-secure-headers/
- OWASP CSP Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- MDN CSP: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- CSP Evaluator: https://csp-evaluator.withgoogle.com/
- Security Headers (evaluate production headers): https://securityheaders.com/
