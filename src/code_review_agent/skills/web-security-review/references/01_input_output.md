# 01 Injection (Confusing Data with Instructions)

## Contents
- Root cause
- XSS: injecting into a trusted document
- SQLi / NoSQLi: query language injection
- Command injection: shell injection
- SSTI: template engine injection
- XXE: XML external entity injection
- Questions to use during review
- References

## Root Cause

Injection vulnerabilities persist because of a single design habit: **passing data and instructions through the same channel**.

Building SQL by string concatenation, embedding user input directly into HTML, concatenating parameters into shell commands — all share the same structure: when attacker-controlled content reaches an execution engine, the engine interprets it as a command. The door is already open in the design, before any attacker acts.

Checking for "is `innerHTML` being used?" is surface-level. The real work is **tracing where a user-controlled value originates and which execution context it reaches** — a data-flow exercise, not a line-by-line scan.

---

## XSS: Injecting into a Trusted Document

### Mechanism of impact

The browser treats an HTML document as trusted and executes scripts within it. XSS works by mixing attacker-controlled strings into that document, causing the browser to believe the script **came from the site the user trusts**.

The impact goes far beyond an alert box:
- **Session hijacking**: `document.cookie` exfiltrated to an attacker server → attacker operates as the user
- **Phishing**: DOM rewritten to inject a fake login form
- **Keylogging**: form input captured in real time
- **Stored XSS cascade**: an admin viewing a page in their browser triggers server-side operations

### Line of reasoning in code

**The question to ask: "Where does this value come from, and where does it land?"**

```
User-controlled sources:
  req.body / req.params / req.query
  location.search / location.hash / location.href
  document.referrer / window.name
  postMessage / localStorage (if written by XSS)
  WebSocket messages / SSE data

Dangerous sinks (execution contexts):
  HTML context   → innerHTML / outerHTML / document.write
  JS context     → eval / setTimeout(string) / new Function(string)
  Attr context   → href="javascript:..." / onclick="...${value}..."
  URL context    → location.href = userInput  (javascript: scheme)
```

Checking for dangerous API usage alone is not enough — trace the **full data flow from source to sink**. Even when a framework's defaults are safe, these are common escape hatches:

```javascript
// React defaults are safe, but these three pass directly into execution contexts
dangerouslySetInnerHTML={{ __html: value }}   // HTML context
href={`javascript:${value}`}                 // URL context (not auto-escaped)
<div onClick={() => eval(value)} />           // JS context

// Even template literals are dangerous if the result goes into innerHTML
element.innerHTML = `<a href="${userUrl}">link</a>`;
// userUrl = 'javascript:alert(1)' → XSS on click
```

**Question the assumption "it's sanitized, so it's safe"**

Sanitization must match the context. HTML escaping works for HTML context but is insufficient for JS string context or attribute context:

```javascript
// HTML-escaped value inserted into a JavaScript string attribute
const escaped = value.replace(/</g, '&lt;');
element.setAttribute('onclick', `doSomething('${escaped}')`);
// value = "'); maliciousCode(); //" → escaping does not help here
```

---

## SQLi / NoSQLi: Injecting Instructions into a Query Language

### Mechanism of impact

"Just use parameterized queries" sounds final, but the problem is deeper. Even with an ORM, raw query escape hatches and dynamic `ORDER BY` / `LIKE` clauses become bypass points.

Impact extends beyond data reads:
- **Auth bypass**: `' OR '1'='1` retrieves all users
- **Data destruction**: `; DROP TABLE users; --`
- **File read/write** (MySQL `LOAD DATA` / `INTO OUTFILE`)
- **OS command execution** (PostgreSQL `COPY TO PROGRAM`, `xp_cmdshell`)
- **Blind SQLi**: even without error output, timing differences allow extracting data one bit at a time

### Line of reasoning in code

Look for **user input influencing the structure** of a query, not just the values:

```javascript
// Obvious case
db.query(`SELECT * FROM users WHERE name = '${name}'`);

// Overlooked case 1: dynamic column or table name
// Column/table names cannot be passed as placeholders
const sortBy = req.query.sort;
db.query(`SELECT * FROM products ORDER BY ${sortBy}`);
// → must use a whitelist of allowed column names

// Overlooked case 2: raw() inside an ORM
User.findAll({ where: sequelize.literal(`name = '${name}'`) });

// Overlooked case 3: LIKE wildcard escaping
// Even with a placeholder, % and _ act as wildcards inside the value
db.query('SELECT * FROM files WHERE name LIKE ?', [`%${userInput}%`]);
// userInput = "%" → returns all rows
```

---

## Command Injection: Injecting Instructions into a Shell

### Mechanism of impact

When command injection succeeds, the blast radius typically exceeds XSS or SQLi. The shell has direct OS access:
- **Arbitrary file read/write** (`/etc/passwd`, private keys)
- **Establish outbound connection** (reverse shell)
- **Lateral movement** to other internal systems
- **Service disruption** (`rm -rf /`, fork bomb)

### Line of reasoning in code

The key question is whether the shell is involved. `exec`-family functions pass a string to the shell, allowing `;` `&&` `|` `` ` `` `$()` to append commands.

```javascript
// Shell is invoked (dangerous)
exec(`convert ${filename} output.jpg`);         // shell: true implicit
execSync(`imagemagick -resize ${size} img.jpg`);

// Shell is NOT invoked (safe)
execFile('convert', [filename, 'output.jpg']);  // args as array → no shell parsing
spawn('convert', [filename, 'output.jpg']);
```

Even with `execFile`, if the **command itself** is user-controlled, it's a different but equally serious problem:
```javascript
const tool = req.body.tool;
execFile(tool, ['-rf', '/']);  // not command injection, but arbitrary command execution
```

---

## SSTI: Injecting Instructions into a Template Engine

### Mechanism of impact

Template engines are designed to trust whoever writes the templates. Evaluating user input as a template string is equivalent to granting the user execution rights inside that engine.

In Jinja2, the template can reach Python internals:
```python
{{ ''.__class__.__mro__[1].__subclasses__() }}  # enumerate all classes
{{ ''.__class__.__mro__[1].__subclasses__()[132].__init__.__globals__['os'].system('id') }}
```

### Line of reasoning in code

Distinguish "passed as a value" from "evaluated as a template":

```python
# Safe: value is passed, not evaluated as template syntax
template = Template("Hello {{ name }}")
template.render(name=user_input)  # user_input = "{{ 7*7 }}" → rendered as literal text

# Dangerous: user input IS the template
template = Template(user_input)   # user_input = "{{ 7*7 }}" → outputs "49"
template.render()
```

Pay attention to features where users type strings that feed into template rendering: email bodies, report templates, configuration values.

---

## XXE: Injecting External References into an XML Parser

### Mechanism of impact

XML supports external entity references — the ability to include external files or URLs inline. Many parsers enable this by default. The problem is not the feature itself but **failing to disable it when processing user-supplied XML**.

```xml
<!-- Attacker-supplied XML -->
<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<user><name>&xxe;</name></user>
<!-- Parser expands /etc/passwd content into the response -->
```

Impact: file reads (including internal network), SSRF via external URL references, and DoS via Billion Laughs attacks.

### Line of reasoning in code

SVG and Office documents (docx/xlsx) are XML-based. APIs that don't advertise XML handling may still process it:

```python
# Easy to overlook: SVG processing
from lxml import etree
tree = etree.parse(uploaded_svg)  # SVG is XML; external entities may be active

# Safe: explicitly disable external entities
parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
tree = etree.parse(uploaded_svg, parser)
```

---

## Questions to Use During Review

Before the technical scan, hold these questions while reading the patch:

1. **Where does user-controlled input originate in this PR?** (identify sources)
2. **Which execution engine does it reach?** (SQL / HTML / shell / template / XML parser)
3. **Is there a mechanism that separates data from instructions before it arrives?** (placeholders, escaping, context-appropriate encoding)
4. **Is the "sanitization" appropriate for the specific context it lands in?**

---

## References

- OWASP Injection (A05:2025): https://owasp.org/Top10/2025/A05_2025-Injection/
- OWASP XSS Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP DOM XSS Prevention: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
- OWASP SQL Injection Prevention: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- OWASP Command Injection Defense: https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html
- OWASP XXE Prevention: https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html
- PortSwigger Web Security Academy: https://portswigger.net/web-security
