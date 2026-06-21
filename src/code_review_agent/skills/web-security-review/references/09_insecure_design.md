# 09 Insecure Design (When Correct Code Implements a Flawed Design)

## Contents
- Root cause
- Business logic flaws
- Mass assignment
- Excessive data exposure
- Missing rate limiting
- Questions to use during review
- References

## Root Cause

Design flaws cannot be fixed by patching the implementation. This is the fundamental difference from other vulnerability categories.

SQL injection can be fixed with parameterized queries. XSS can be fixed by adding escaping. But "a design that accepts prices from the client without server-side validation" cannot be made safe by changing how the code reads that value — the design itself must change.

Finding design-level problems in a PR requires asking not "does this code work correctly?" but **"given this design, what can a malicious user do?"** This means reading the architecture from an attacker's perspective rather than tracing the logic of the code.

---

## Business Logic Flaws: "Works Correctly" Does Not Mean "Safe"

### Mechanism of impact

Business logic vulnerabilities arise when an attacker **operates the system in a sequence or with values the designer did not intend**. The code functions as written — the flaw is in the assumptions embedded in the design.

Classic example — price tampering:
```
Designer's assumption: "Users pay the price displayed on the checkout screen."
Attacker's action: POST directly to the checkout API with price: 0
```

This code has no bug. `req.body.price` is read and passed to order creation exactly as intended. The flaw is in the trust decision: what should the server trust?

Other common patterns:
- **State machine skipping**: transitioning directly to "shipped" without going through "payment confirmed"
- **Coupon reuse**: Race Condition allowing one coupon to be applied multiple times
- **Balance double-spend**: sending the same balance-check twice before deduction completes

Impact connects directly to financial loss, unauthorized privilege, and data integrity failures.

### Line of reasoning in code

**Find places where client-supplied values are used in business operations without server-side recalculation.**

```javascript
// Price from client used directly
const { items, totalPrice } = req.body;
await createOrder({ items, price: totalPrice });  // totalPrice is untrusted

// Status transition initiated by client
const { orderId, newStatus } = req.body;
await Order.findByIdAndUpdate(orderId, { status: newStatus });
// Sending newStatus: 'shipped' bypasses payment

// Race Condition window
const balance = await getBalance(userId);   // check
if (balance >= amount) {                     // gap: same check can pass concurrently
  await deductBalance(userId, amount);       // deduct
}
```

---

## Mass Assignment: The Blind Spot of "Assign Everything at Once"

### Mechanism of impact

ORM convenience features that map a request body directly to a model mean "any field in the body can be updated." Fields the developer did not intend to expose — `role`, `isAdmin`, `verifiedAt` — become writable if included in the request body.

```javascript
// Developer's intent: let users update their name and email
await User.findByIdAndUpdate(id, req.body);
// Attacker sends: { name: 'Alice', email: 'a@b.com', role: 'admin' }
```

This is a design problem, not a validation problem. The fix is not to validate that `role` contains an acceptable value — it is to explicitly declare which fields are updatable.

### Line of reasoning in code

Look for patterns where `req.body` passes directly into an ORM update:

```javascript
// Patterns to flag
Model.update(req.body)
Model.findByIdAndUpdate(id, req.body)
Object.assign(record, req.body)
entity.fill(request->all())   // Laravel
@user.update(user_params)     // Rails — verify Strong Parameters scope

// Fix: explicitly extract only intended fields
const { name, email, bio } = req.body;
await User.findByIdAndUpdate(id, { name, email, bio });
```

---

## Excessive Data Exposure: "Returning Too Much"

### Mechanism of impact

APIs returning more data than necessary is not a mere efficiency problem — it is a security problem. What is not displayed in the frontend is still present in the response and readable via developer tools. This data may also be cached, logged, or forwarded to external services.

```javascript
// Returns the full user object
app.get('/api/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(user);  // includes passwordHash, role, internalNotes, secretToken
});
```

In GraphQL, field-level authorization is required. Schema-defined fields can be queried by clients. Without resolver-level checks, admin-only fields may be accessible to regular users.

---

## Missing Rate Limiting: "Unlimited Attempts" as a Design Choice

### Mechanism of impact

No rate limiting means no upper bound on attempts. This matters for:

- **Authentication endpoints**: passwords can be brute-forced
- **OTP / SMS sending**: bulk sending causes cost explosion or harassment
- **Password reset**: resets flood a target's inbox
- **Expensive operations**: external API calls, image processing, AI inference

"Login failure limiting" and "rate limiting" are different. The former protects against brute force on a specific account; the latter controls overall request volume. Both may be needed simultaneously.

### Line of reasoning in code

When examining new API endpoints, check whether a rate limiting middleware is applied:

```javascript
// New endpoint without rate limiting
app.post('/api/send-otp', sendOtpHandler);

// Rate limiter defined but check scope
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);  // does /api/send-otp fall inside this scope?

// Auth endpoints should be more restrictive
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
app.post('/api/login', authLimiter, loginHandler);
```

---

## Questions to Use During Review

1. **With this design, what can an attacker do that the designer did not intend?** Try role changes, price tampering, and state skipping mentally.
2. **Is `req.body` passed directly to an ORM update?** Are updatable fields explicitly declared?
3. **Does the new API return fields that are unnecessary for the caller?** (role info, internal data)
4. **Is rate limiting applied to expensive or sensitive operations?** Is any new endpoint outside the limiter's scope?
5. **Between "check" and "execute," is there a Race Condition window?** Is a transaction or atomic operation in use?

---

## References

- OWASP Insecure Design (A06:2025): https://owasp.org/Top10/2025/A06_2025-Insecure_Design/
- OWASP Business Logic Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html
- OWASP Mass Assignment Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
- PortSwigger Business Logic Vulnerabilities: https://portswigger.net/web-security/logic-flaws
