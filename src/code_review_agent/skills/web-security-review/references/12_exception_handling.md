# 12 Exception Handling Failures (When Error Paths Are Not Designed)

## Contents
- Root cause
- Fail-open: exception path grants access
- Swallowed exceptions
- Timeouts and external dependencies
- Patterns to find in PR diffs
- Questions to use during review
- References

## Root Cause

Exception handling is almost always deferred. Once the happy path works, error cases are handled with a catch-all. But from a security perspective, **the behavior when something goes wrong is exactly what matters**.

Not "is authentication working correctly?" but "what happens when the auth service is unresponsive, the JWT is malformed, or the database is down?" Those are the conditions an attacker can deliberately create.

OWASP added A10 in 2025 because this class of problem was routinely dismissed as a "code quality issue" when it is in fact an exploitable security failure — one triggered by forcing the system into abnormal conditions.

---

## Fail-Open: The Exception Path Grants Access

### Mechanism of impact

"Fail-open" means: when an error occurs in a security check, access is **granted** rather than denied. The security principle is fail-closed: **errors deny**.

```javascript
// The developer's intent was to verify a JWT
async function authenticate(token) {
  try {
    const user = await verifyJWT(token);
    return user;
  } catch (e) {
    return null;  // ← returns null
  }
}

// One call site
const user = await authenticate(token);
if (user) {
  // authenticated path
}
// If verifyJWT throws, null is returned → if (null) → false → denied
// This is fail-closed. But:

// Another call site
if (await authenticate(token) !== false) {
  // authenticated path
}
// null !== false → true → authenticated! Fail-open.
```

`catch { return true; }` is obvious fail-open. The more dangerous pattern is **inadvertent fail-open** — the function returns a "neutral" value like `null` or `undefined`, and the call site interprets it as granted.

### Line of reasoning in code

Examine what `catch` blocks return in security checks:

```javascript
// Obvious fail-open
async function isAdmin(userId) {
  try {
    const role = await fetchRole(userId);
    return role === 'admin';
  } catch (e) {
    return true;  // ← treats every error as "this user is admin"
  }
}

// Subtle fail-open (depends on how caller interprets null)
async function getAuthenticatedUser(token) {
  try {
    return await db.findUserByToken(token);
  } catch (e) {
    return null;  // fail-closed if caller uses if (user) { }
                  // fail-open if caller uses if (user !== undefined) { }
  }
}

// Safe: exception causes explicit denial
async function isAdmin(userId) {
  try {
    const role = await fetchRole(userId);
    return role === 'admin';
  } catch (e) {
    logger.error('Role check failed', { userId, error: e.message });
    return false;  // ← error means "not admin"
  }
}
```

---

## Swallowed Exceptions: Making Problems Disappear

### Mechanism of impact

Empty `catch` blocks or log-only-and-continue patterns cause two problems:

1. **Audit trail erasure**: security events that fail are not recorded
2. **State corruption**: processing continues from a partially-failed state

```javascript
// Audit log silenced
try {
  await auditLogger.log({ userId, action, resource });
} catch (e) {}
// An attacker who deliberately disrupts the audit service can erase their tracks

// State corruption
try {
  await chargePayment(amount);
} catch (e) {
  console.error(e);
  // continues → order is created without successful payment
}
await createOrder(items);
```

### Line of reasoning in code

`catch (e) {}` and `catch (e) { console.log(e); }` are nearly equivalent as problems. Logging but continuing from an unknown state is as dangerous as silent swallowing:

```javascript
// Problematic patterns
try { sensitiveOperation(); } catch (e) {}           // silent
try { sensitiveOperation(); } catch (e) { log(e); }  // logged but execution continues in unknown state

// Safe pattern
try {
  sensitiveOperation();
} catch (e) {
  logger.error('Operation failed', { error: e.message, userId });
  await rollback();           // restore safe state
  throw new AppError(500);    // propagate — don't swallow
}
```

---

## Timeouts and External Dependencies: Designing for Unavailability

### Mechanism of impact

Without timeouts on external service calls (auth service, permission DB, external API), the application hangs indefinitely when those services are unavailable. This can be used as a DoS vector.

More critically, what the `catch` block does when a timeout fires determines fail-open vs. fail-closed behavior:

```javascript
// No timeout + no error handling (worst case)
const user = await authService.verify(token);  // may wait forever

// Timeout + fail-open (bad)
try {
  const user = await authService.verify(token, { timeout: 3000 });
  return user;
} catch (e) {
  if (e.name === 'TimeoutError') return defaultUser;  // timeout → treat as authenticated
}

// Timeout + fail-closed (safe)
try {
  const user = await authService.verify(token, { timeout: 3000 });
  return user;
} catch (e) {
  logger.warn('Auth service unavailable', { error: e.message });
  return null;  // timeout → treat as unauthenticated
}
```

---

## Patterns to Find in PR Diffs

```
Signals of fail-open or swallowed exceptions:
  catch (e) { return true; }
  catch (e) { return null; }    ← check how caller interprets null
  catch (e) {}                   ← silent swallow
  catch (error) { next(); }     ← Express: passes to next middleware, may skip auth
  || true                        ← default value of true for a boolean check
  ?? true                        ← nullish coalescing defaulting to true
```

---

## Questions to Use During Review

1. **In `catch` blocks for auth/authz checks, what is returned?** Could it be interpreted as "access granted"?
2. **Is the caller's interpretation of the return value unambiguous?** Does `null`/`undefined`/`false` mean the same thing to all callers?
3. **When an exception is swallowed, does subsequent execution continue from a consistent state?**
4. **Are timeouts set for external service calls?** Does the timeout path fail-closed?
5. **Does any error handler swallow exceptions and return a success response?**

---

## References

- OWASP A10:2025 Mishandling of Exceptional Conditions: https://owasp.org/Top10/2025/A10_2025-Mishandling_of_Exceptional_Conditions/
- OWASP Error Handling Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html
- CWE-636 (Not Failing Securely / Fail-Open): https://cwe.mitre.org/data/definitions/636.html
- CWE-391 (Unchecked Error Condition): https://cwe.mitre.org/data/definitions/391.html
