# 11 SSRF & Security Logging (Invisible Requests and Invisible Attacks)

## Contents
- SSRF: root cause
- SSRF: mechanism and line of reasoning
- Security logging: root cause
- Security logging: mechanism and line of reasoning
- Questions to use during review
- References

## SSRF: Using the Server as a Proxy

### Root Cause

SSRF is fundamentally about **an attacker taking control of a feature designed to make outbound requests on the user's behalf**.

Web apps that fetch URLs at user direction — OGP previews, webhooks, image imports, URL previews — have a legitimate purpose. But "can send requests to any URL specified by the user" and "can send requests to the URL I specify" are structurally different. The former turns the server into a pivot point into internal networks.

In cloud environments, `169.254.169.254` (IMDSv1) is the instance metadata endpoint for AWS/GCP/Azure, providing IAM credentials and environment data. It is unreachable from the internet but **reachable from the server itself**. SSRF erases this inside/outside boundary.

### Mechanism of impact

When an attacker finds a URL-fetching feature, their questions are:
- Can I send a request to `http://localhost:8080/admin`? (internal admin panel)
- Can I reach `http://169.254.169.254/latest/meta-data/iam/security-credentials/`? (cloud IAM credentials)
- Can I use `file:///etc/passwd`? (local file read)
- Can I reach `http://192.168.1.1/`? (internal network scanning)

Impact ranges from internal service access to credential theft to full compromise of the cloud account's IAM role.

### Line of reasoning in code

Find places where the server makes an outbound request to a URL from user input:

```javascript
// Obvious case
const url = req.body.webhookUrl;
await fetch(url);  // unrestricted

// Easy to overlook: indirect URL specification
const imageUrl = req.body.profileImageUrl;
const image = await axios.get(imageUrl);  // "just fetching an image" but any URL is reachable

// Redirect following is also a problem
// With follow: true (default), redirects to internal IPs are pursued
```

Blocklisting is weaker than allowlisting. "Allow only these" has fewer gaps than "block these others":

```javascript
// Blocklist approach (gaps exist)
const parsed = new URL(url);
if (parsed.hostname === 'localhost') throw new Error('Blocked');
// Bypasses: 127.0.0.1, 0x7f000001, [::1], http://2130706433/

// Closer to safe: resolve DNS and check IP ranges
async function isSafeUrl(urlStr) {
  const url = new URL(urlStr);
  if (!['http:', 'https:'].includes(url.protocol)) return false;

  const { address } = await dns.lookup(url.hostname);
  // Block RFC1918 private ranges and link-local
  if (isPrivateIP(address)) return false;
  return true;
}
// Note: DNS Rebinding requires additional mitigations
```

---

## Security Logging: "Can You Know What Happened After the Fact?"

### Root Cause

The most common misunderstanding about logging is treating "recording events" as the goal. The real purpose is: **when an incident occurs, can you understand what happened, determine the blast radius, and identify the attacker?**

OWASP renamed A09 in 2025 from "Monitoring" to "**Alerting** Failures" precisely to make this explicit. Good logs with no alerting have minimal value for identifying incidents in time to act.

### Mechanism of impact

Absent or inadequate logging does not cause an attack to succeed — it causes **the attack to go undetected or the response to be delayed**.

- No login failure logging → brute force runs unchecked with no signal
- No IDOR attempt logging → attacker scans thousands of records without triggering any alert
- No admin operation logging → internal abuse is unprovable after the fact

"No evidence of attack" and "unable to determine whether attack occurred because there are no records" are completely different statements — without logs they are indistinguishable.

### Line of reasoning in code

Read logs with the question: "could an incident responder use this to reconstruct what happened?"

```javascript
// Has the form of logging, but unusable for investigation
console.log('Login failed');
// → who, from where, how many times — all unknown

// Functions as a security event
logger.warn({
  event: 'auth.login.failed',
  userId: req.body.username,
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  attemptedAt: new Date().toISOString(),
});
// → who, from where, when — reconstructible; threshold-based alerting is possible
```

**"Does this log connect to an alert?" is the design question:**

```javascript
// Log exists but no alert (A09:2025 failure mode)
logger.warn('Suspicious activity detected');
// → flows to CloudWatch, but no metric filter or alarm defined → no one sees it

// Alert design should be part of the same PR as the logging
// CloudWatch Metric Filter → Alarm → SNS → PagerDuty/Slack
// Datadog Log Monitor → Notification
```

Also flag `catch` blocks that swallow errors (see also `12_exception_handling.md`):

```javascript
try {
  await auditLog.record(event);
} catch (e) {}  // audit log failure silently swallowed → attacker activity may disappear
```

---

## Questions to Use During Review

### SSRF
1. **Does the code send server-side requests to user-specified URLs?** If so, how is the URL validated?
2. **Is the URL scheme restricted?** `file://`, `dict://`, `gopher://` dramatically expand impact.
3. **After DNS resolution, is the resulting IP checked against private ranges?** Name-based blocking is bypassable.

### Logging
1. **Are authentication successes, failures, and authorization errors recorded as events?** Do they include "who, when, from where"?
2. **Is the log structured (JSON etc.) for machine aggregation and alerting?**
3. **Is the log connected to an actual alert?** Recording without alerting does not detect attacks.

---

## References

- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- PortSwigger SSRF: https://portswigger.net/web-security/ssrf
- OWASP A09:2025 Security Logging and Alerting Failures: https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Logging Vocabulary Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html
