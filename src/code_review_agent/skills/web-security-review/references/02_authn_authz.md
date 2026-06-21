# 02 Authentication & Authorization (Confusing Identity with Permission)

## Contents
- Root cause
- Missing authorization: open APIs
- JWT misuse: verified vs. trustworthy
- Session management
- Cryptographic failures
- Questions to use during review
- References

## Root Cause

Authentication and authorization are distinct problems that are frequently conflated.

- **Authentication**: confirms this request actually comes from who it claims to be
- **Authorization**: determines whether that identity is permitted to perform this operation

The SPA era introduced a specific failure mode: the frontend can hide a screen with route guards, but it cannot hide an API endpoint. Designs that substitute UI visibility for authorization checks produce "unreachable-from-the-screen-but-callable API endpoints" — a pattern that repeats constantly.

A second structural problem is the **question of where the trust boundary sits**. Every value arriving from a client — JWT payload, cookie content, request body fields — can be freely modified by an attacker. Finding "places where the server trusts a client-supplied value" is the core of this review.

---

## Missing Authorization: "Every API Is Open by Default"

### Mechanism of impact

When adding an API endpoint, the implementer's focus is typically "does it behave correctly?" The question "can anyone call this?" is deferred. The result:

- **Vertical privilege escalation**: a regular user can call admin APIs
- **Horizontal privilege escalation (IDOR)**: user A can access user B's resources

IDOR is the most commonly missed pattern because the code "works correctly" — it fetches and returns the right record. The problem is that it fetches anyone's record.

```javascript
// Works correctly. The problem: anyone can call it.
app.get('/api/invoices/:id', async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  res.json(invoice);
});
// Attacker iterates id = 1, 2, 3, ... and retrieves all invoices
```

Impact extends beyond data reads: applied to PUT/DELETE, this means **modifying or deleting another user's data**. In healthcare, finance, or PII contexts this carries legal liability.

### Line of reasoning in code

**Ask: "Can anyone execute this operation?" and "Does this resource actually belong to the caller?"**

When examining a new endpoint, first check whether auth middleware wraps it:

```javascript
// Middleware scope gaps
app.get('/api/public',  publicHandler);
app.use(authMiddleware);                    // Auth applies from here down, but...
app.get('/api/users',   usersHandler);      // Authenticated
app.get('/api/admin',   adminHandler);      // Authenticated but no role check

// New endpoint accidentally placed outside middleware
app.post('/api/webhook', webhookHandler);   // Before authMiddleware — no auth
app.use(authMiddleware);
```

Check IDOR for every read/update/delete operation. PATCH and DELETE are most commonly overlooked:

```javascript
// Read has a check; delete does not
app.delete('/api/comments/:id', auth, async (req, res) => {
  // No comparison of req.user.id with comment.authorId
  await Comment.findByIdAndDelete(req.params.id);
});
```

---

## JWT Misuse: Confusing "Verified" with "Trustworthy"

### Mechanism of impact

JWT is designed around "if you verify the signature, you can trust the payload." Two implementation errors break this assumption:

**1. alg: none attack**: implementations that extract the algorithm from the JWT header itself can be sent a token with `alg: "none"`, causing verification to succeed with no signature at all.

**2. Algorithm confusion (RS256 → HS256)**: if a server accepts both RS256 (asymmetric) and HS256 (symmetric), an attacker can take a token, change the header to HS256, and **sign it with the server's public key used as the HMAC secret**. Since public keys are often distributed openly, this forges valid tokens.

Both allow arbitrary JWT payloads — including arbitrary user IDs and roles.

### Line of reasoning in code

Trace where the algorithm is decided:

```javascript
// Dangerous: the token itself decides its algorithm
const decoded = jwt.decode(token, { complete: true });
jwt.verify(token, secret, { algorithms: [decoded.header.alg] });
// Sending { "alg": "none" } causes verify to pass unconditionally

// Dangerous: accepting multiple algorithms (opens confusion attack)
jwt.verify(token, publicKey, { algorithms: ['RS256', 'HS256'] });

// Safe: server fixes the algorithm
jwt.verify(token, secret, { algorithms: ['HS256'] });
```

Also check for **using JWT payload fields directly for authorization decisions** without re-checking against a database. A `role: "admin"` claim was true at token issuance — it does not reflect permission changes or account suspension that happened since.

---

## Session Management: The Weight of a Session ID

### Mechanism of impact

A session ID is a condensed representation of "authentication has occurred." Whoever holds that ID is treated as that user, regardless of who they actually are. This means:

- **Session fixation**: if the session ID issued before login remains valid after login, an attacker who knew the pre-login ID inherits the authenticated session
- **Session hijacking**: stealing the cookie via XSS, or via network interception when HTTPS is absent

Server-side session invalidation on logout is particularly overlooked. Deleting the client-side cookie is not enough — an attacker who captured the ID can still use it if the server still considers it valid.

### Line of reasoning in code

Always review login and logout implementations together:

```javascript
// Login: is a new session ID generated after authentication?
app.post('/login', (req, res) => {
  // After successful credential check:
  req.session.regenerate((err) => {  // ← regenerate ID (prevents fixation)
    req.session.userId = user.id;
    res.json({ success: true });
  });
  // Setting req.session.userId without regenerate leaves the pre-auth ID active
});

// Logout: is the server-side session data destroyed?
app.post('/logout', (req, res) => {
  req.session.destroy();    // ← invalidates server-side session
  res.clearCookie('sessionId');
  // clearCookie alone doesn't help if the server still accepts the ID
});
```

---

## Cryptographic Failures: When "Fast" Is a Vulnerability

### Mechanism of impact

The problem with MD5/SHA-1 for password hashing is not that they are "weak" — it is that they are **fast**. A GPU can compute billions of hashes per second. Once a database leaks, rainbow tables or brute force can recover plaintext in hours. bcrypt/argon2/scrypt are "safe" because they are **intentionally slow** via a cost factor. A bcrypt call with cost factor 4 is nearly as fast as SHA-256 and provides almost no protection.

`Math.random()` shares the same structural problem. JavaScript's `Math.random()` is based on a linear congruential generator whose internal state is predictable. Using it for password reset tokens or auth codes allows an attacker to predict upcoming values.

### Line of reasoning in code

Look not just at "is it hashed?" but "which function, for what purpose, with what parameters?":

```javascript
// Both hash, but are they appropriate?
crypto.createHash('sha256').update(password).digest('hex');  // fast → wrong for passwords
await bcrypt.hash(password, 4);   // low cost factor → still too fast

// Appropriate
await bcrypt.hash(password, 12);  // 2^12 rounds; tune to server capacity

// Token generation
Math.random().toString(36).slice(2);          // predictable
crypto.randomBytes(32).toString('hex');        // cryptographically secure
```

ECB mode leaks patterns: identical plaintext blocks always produce identical ciphertext blocks. This is the "Penguin ECB" problem — block-level repetition is visible in the output.

---

## Questions to Use During Review

1. **Is each new API endpoint protected against callers with no authentication?** Check middleware scope.
2. **For every resource fetch/update/delete, does the code verify the resource belongs to the caller?**
3. **Is the JWT algorithm fixed server-side?** Is it ever read from the token itself?
4. **On login, is the session ID regenerated? On logout, is the server-side session destroyed?**
5. **Is the hash/token-generation function the right one for the use case?** Cost factor set appropriately?

---

## References

- OWASP Broken Access Control (A01:2025): https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP JWT Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- JWT Vulnerabilities (PortSwigger): https://portswigger.net/web-security/jwt
