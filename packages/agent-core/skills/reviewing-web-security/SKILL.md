---
name: reviewing-web-security
description: Performs security code review of SPA and MPA web applications by analyzing GitHub PR file changes, patches, and project context to identify vulnerabilities. Use when asked to review code for security issues, perform a security audit of a PR, check for XSS/CSRF/SQLi/auth flaws, or evaluate any web application code for security risks.
---

# Web Application Security Code Review

## How to Review

### Step 1: Characterize the PR (30 seconds)

Scan the patch and classify the change type.

| Change type          | Security impact                   |
|----------------------|-----------------------------------|
| New feature          | High: new attack surface          |
| Auth/authz logic     | Critical: always read deeply      |
| Dependency update    | Medium–High: check CVEs           |
| Configuration change | Medium–High: relaxed or hardened? |
| Refactor only        | Low: verify behavior unchanged    |
| UI only              | Low: check DOM write methods      |

### Step 2: Select references by signal

Scan the patch for these signals and load the matching reference. Read only what is relevant.

```text
Signal → Reference
──────────────────────────────────────────────────────────
innerHTML / dangerouslySetInnerHTML / v-html
exec() / child_process / os.system / yaml.load
user input → HTML / SQL / shell                   → 01_input_output.md

JWT / session / cookie / login / password
Math.random for tokens / non-bcrypt hash          → 02_authn_authz.md

fetch / axios / CORS headers / Origin validation  → 03_csrf_cors.md

package.json / requirements.txt / lock files
new library / version change                      → 04_dependencies.md

API_KEY / SECRET hardcoded / .env / log output
error response changes                            → 05_secrets_exposure.md

Content-Security-Policy / nginx.conf / middleware
HTTP header changes                               → 06_security_headers.md

file upload / multer / FormData / path joining    → 07_file_upload.md

NODE_ENV / DEBUG / Docker / deploy config         → 08_config_env.md

req.body passed to ORM / price or role from body
new endpoint without rate limiting                → 09_insecure_design.md

pickle / serialize / yaml.load / CDN <script>
object merge with __proto__                       → 10_integrity_failures.md

fetch(userUrl) / server-side URL fetch
logger / audit / logging design                   → 11_ssrf_logging.md

catch (e) { return true; } / catch (e) {}
|| true / ?? true / no timeout on external call   → 12_exception_handling.md
```

### Step 3: Write structured findings

```text
[Severity] Title

Location: filename:line

Problem: What is wrong and why it is a vulnerability.

Attack scenario: How an attacker exploits this (1–2 sentences).

Fix: What to change concretely.

References: OWASP / CWE links (see reference files).
```

| Severity    | Criteria                                     |
|-------------|----------------------------------------------|
| 🔴 Critical | Exploitable immediately; block deployment    |
| 🟠 High     | Exploitable under conditions; fix this cycle |
| 🟡 Medium   | Requires preconditions; next cycle           |
| 🔵 Low      | Best practice deviation                      |
| ℹ️ Info     | No fix required                              |

---

## Reference Files

| File                                                            | Topic                                             |
|-----------------------------------------------------------------|---------------------------------------------------|
| [01_input_output.md](references/01_input_output.md)             | Injection, XSS, SQLi, command injection, XXE      |
| [02_authn_authz.md](references/02_authn_authz.md)               | Auth, authz, JWT, sessions, cryptography          |
| [03_csrf_cors.md](references/03_csrf_cors.md)                   | CSRF, CORS                                        |
| [04_dependencies.md](references/04_dependencies.md)             | Dependencies, CVEs, supply chain                  |
| [05_secrets_exposure.md](references/05_secrets_exposure.md)     | Secrets, logging, error responses                 |
| [06_security_headers.md](references/06_security_headers.md)     | Security headers, CSP                             |
| [07_file_upload.md](references/07_file_upload.md)               | File upload, path traversal                       |
| [08_config_env.md](references/08_config_env.md)                 | Config, environment, debug flags                  |
| [09_insecure_design.md](references/09_insecure_design.md)       | Insecure design, mass assignment, race conditions |
| [10_integrity_failures.md](references/10_integrity_failures.md) | Deserialization, SRI, prototype pollution         |
| [11_ssrf_logging.md](references/11_ssrf_logging.md)             | SSRF, security logging, alerting                  |
| [12_exception_handling.md](references/12_exception_handling.md) | Fail-open, exception handling                     |

---

## Stating Review Limits

When the patch alone is insufficient to judge safety:

> ⚠️ **Verification needed**
> Whether this change is safe depends on `[existing file]`.
> Cannot be confirmed from the PR diff alone — verify separately.
> What to check: [specific question]

---

## OWASP Top 10 Coverage

### 2025 (current)

| OWASP 2025                                      | Reference files             |
|-------------------------------------------------|-----------------------------|
| A01 Broken Access Control (SSRF merged)         | `02`, `09`, `11`            |
| A02 Security Misconfiguration (↑ #2)            | `06`, `08`                  |
| A03 Software Supply Chain Failures (new)        | `04`, `10`                  |
| A04 Cryptographic Failures                      | `02` (crypto section), `05` |
| A05 Injection                                   | `01`                        |
| A06 Insecure Design                             | `09`                        |
| A07 Authentication Failures                     | `02`, `03`                  |
| A08 Software or Data Integrity Failures         | `10`                        |
| A09 Security Logging and Alerting Failures      | `11`, `05`                  |
| A10 Mishandling of Exceptional Conditions (new) | `12`                        |

### 2021 (reference)

| OWASP 2021                           | Reference files |
|--------------------------------------|-----------------|
| A01 Broken Access Control            | `02`, `09`      |
| A02 Cryptographic Failures           | `02`, `05`      |
| A03 Injection                        | `01`            |
| A04 Insecure Design                  | `09`            |
| A05 Security Misconfiguration        | `06`, `08`      |
| A06 Vulnerable Components            | `04`            |
| A07 Auth Failures                    | `02`, `03`      |
| A08 Software/Data Integrity Failures | `10`, `04`      |
| A09 Logging/Monitoring Failures      | `11`, `05`      |
| A10 SSRF                             | `11`, `07`      |
