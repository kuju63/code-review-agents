# 04 Software Supply Chain (The Chain of Trust and Its Blind Spots)

## Contents
- Root cause
- Known vulnerabilities: introduction vs. continuation
- Supply chain attacks: trusted packages that change
- SBOM: knowing what you trust
- Questions to use during review
- References

## Root Cause

Dependencies are a problem because **the chain of trust delegation is invisible**.

You know the intent of your own code. But when you add an npm package, you are implicitly trusting that package, its dependencies, their dependencies, and so on. A modern web app's `node_modules` can contain thousands of packages. How many of those has anyone on the team actually read?

The threat landscape shifted further in 2025. As the SolarWinds attack demonstrated, **trusted vendors can themselves be compromised**. A self-propagating npm worm seeded malicious versions of popular packages. Attackers have moved their focus from "vulnerable code" to "the distribution channel of trusted code."

When reviewing a `package.json` change in a PR, the question is not only "does this package have a known CVE?" but "what is the basis for trusting this package?"

---

## Known Vulnerabilities: "Starting to Use" vs. "Continuing to Use"

### Mechanism of impact

Using a library with a known CVE is an obvious risk. But what is more often missed in PR review is the **evaluation at the point of first introduction**.

```
npm install something-useful
```

What this one command does:
- Executes `something-useful`'s code (postinstall scripts run immediately)
- Does the same for every package it depends on transitively
- All of these will run on every build and deployment going forward

Impact depends on the vulnerability type. An RCE in a logging utility (Log4Shell) is just as dangerous as one in core business logic. "It's only a helper library" is not a valid risk reduction argument.

### Line of reasoning in code

**Read the direction and reason for version changes.**

```json
// Upgrade → why now? CVE fix or feature addition?
"express": "4.18.1" → "4.19.2"

// Downgrade → did something break?
"lodash": "4.17.21" → "4.17.19"  // 4.17.19 has known CVEs

// Range relaxation → intentional?
"axios": "1.4.0" → "^1.4.0"  // future minor updates now come in automatically

// New package → why this one?
"+  \"node-html-parser\": \"^6.1.0\""  // has had DOM XSS vulnerabilities in the past
```

Transitive dependency changes are visible in lock files but impractical to CVE-check exhaustively:
```
When package-lock.json changes show a large number of package updates:
→ The important question is why the lock file changed so much.
  Was it regenerated from scratch? Was it pulled in by a direct dependency update?
```

### CVE lookup resources

```bash
# Scan without regenerating the lock file
npm audit

# Per-package CVE lookup
https://osv.dev/          # Open Source Vulnerabilities, OWASP-recommended
https://security.snyk.io/ # Detailed info with fix version guidance
```

---

## Supply Chain Attacks: "What You Trusted Has Changed"

### Mechanism of impact

"Using a vulnerable library" and "a library you trusted has become malicious" are different problems.

**Typosquatting**
```
react   → raect
lodash  → 1odash (digit 1 vs letter l)
```

**Maintainer account takeover**
- NPM account phished from a long-dormant package maintainer
- Malicious version published
- Propagates to all downstream dependents automatically

**Instant execution via postinstall**
```json
"scripts": {
  "postinstall": "node ./collect-env.js"  // runs at npm install time
}
```
Arbitrary code runs the moment `npm install` is executed.

### Line of reasoning in code

When a new package appears in a PR, asking "why this package?" is worthwhile. Pay attention to:

- **Unfamiliar package name**: check for similarity to popular packages
- **Unusually low download count for the use case**: why was this chosen?
- **Recent maintainer change**: check the Contributors tab on GitHub
- **postinstall script present**: read what it does

For CI/CD, pin third-party Actions by SHA rather than tag — tags are mutable:

```yaml
# Tag is mutable (can be repointed)
- uses: actions/checkout@v4

# SHA is immutable (recommended)
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
```

---

## SBOM: Knowing What You Trust

OWASP elevated supply chain to A03 in 2025 partly because of the SBOM imperative. Without knowing what is running in production, you cannot determine whether a newly published CVE affects you.

When dependencies are added or changed in a PR, check whether the project has automated SBOM updates and CVE alerting (GitHub Dependabot, OWASP Dependency-Track, etc.) — this is the long-term security posture question behind every dependency change.

---

## Questions to Use During Review

1. **Why was this specific package chosen?** Is there a good reason over alternatives?
2. **Do this package and its transitive dependencies have known CVEs?** Has `npm audit` been run?
3. **Is the version pinning intentional?** Does the team understand what `^` and `~` allow?
4. **Does the new package have a postinstall script?** If so, what does it do?
5. **Are third-party CI/CD Actions pinned by SHA?**

---

## References

- OWASP A03:2025 Software Supply Chain Failures: https://owasp.org/Top10/2025/A03_2025-Software_Supply_Chain_Failures/
- OSV (Open Source Vulnerabilities): https://osv.dev/
- Snyk Vulnerability DB: https://security.snyk.io/
- OWASP Dependency-Track: https://owasp.org/www-project-dependency-track/
- OWASP Dependency Graph SBOM Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Dependency_Graph_SBOM_Cheat_Sheet.html
- GitHub Advisory Database: https://github.com/advisories
