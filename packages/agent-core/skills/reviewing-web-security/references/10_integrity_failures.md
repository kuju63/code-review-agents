# 10 Software Integrity Failures (Trusting Without Verifying)

## Contents
- Root cause
- Deserialization: making data execute
- Prototype pollution
- SRI: verifying external resource content
- Questions to use during review
- References

## Root Cause

The integrity problem comes down to a **chain of trust that breaks somewhere**.

Serialization and deserialization move objects through a string representation and reconstruct them later. The "reconstruct" step is the attack surface: if the string comes from an attacker, deserializing it means constructing whatever object the attacker designed.

External resource loading (CDN, npm, build pipelines) shares the same structure. Something "from a trusted source" is executed without verifying that its content actually matches what was trusted.

---

## Deserialization: Making Data Execute

### Mechanism of impact

Unsafe deserialization differs from other vulnerability classes because **reading input can execute arbitrary code** — no separate command execution step is needed. SQL injection triggers a database query. XSS triggers script execution. Deserialization RCE triggers during the object reconstruction process itself, via constructors and magic methods.

Python's `pickle` is the clearest example:
```python
import pickle, os

class Exploit(object):
    def __reduce__(self):
        return (os.system, ('id',))  # os.system('id') runs at deserialization time

data = pickle.dumps(Exploit())
pickle.loads(data)  # ← command executes on this line alone
```

`pickle.loads()` appears to be "reading data" but is actually "executing code."

Java serialized objects in base64 appear in cookies and API parameters. Identifier: base64-decoded value starting with `rO0` indicates a Java serialized object.

### Line of reasoning in code

Find both where deserialization occurs **and** where that data originates:

```python
# Source is user input → dangerous
pickle.loads(request.body)
pickle.loads(base64.b64decode(cookie_value))

yaml.load(user_input)       # PyYAML yaml.load can execute arbitrary code
yaml.safe_load(user_input)  # ← use safe_load instead

# JSON only handles structured data (no functions or classes)
json.loads(user_input)      # safe
```

In JavaScript:
```javascript
// eval and new Function are also problematic in deserialization contexts
const obj = eval('(' + userInput + ')');  // if userInput contains a function, it executes
JSON.parse(userInput);                    // safe — functions are not parsed
```

---

## Prototype Pollution: Corrupting JavaScript Object Roots

### Mechanism of impact

Every JavaScript object inherits from `Object.prototype`. If `__proto__` can be used to modify the prototype chain, **the behavior of all objects in the runtime can be changed**:

```javascript
const userInput = JSON.parse('{"__proto__": {"isAdmin": true}}');
Object.assign({}, userInput);
// Now every object has .isAdmin === true

// Consequence:
if (user.isAdmin) { grantAccess(); }
// user has no isAdmin field, but the prototype chain supplies true
```

This lets an attacker change application behavior through JSON input without writing any code.

### Line of reasoning in code

Look for user input being merged or cloned into objects:

```javascript
// Dangerous: user input merged directly
Object.assign(target, userInput);
_.merge(target, userInput);         // older lodash versions are vulnerable

// Safe: strip dangerous keys before merging
const sanitized = JSON.parse(
  JSON.stringify(userInput, (key, val) =>
    ['__proto__', 'constructor', 'prototype'].includes(key) ? undefined : val
  )
);
```

---

## SRI: Verifying External Resource Content

### Mechanism of impact

Scripts and stylesheets loaded from a CDN provide no guarantee their content is unchanged if the CDN is compromised. SRI tells the browser "this URL should produce a file matching this hash" and blocks loading if it does not:

```html
<!-- No SRI: CDN compromise is undetectable -->
<script src="https://cdn.example.com/jquery-3.6.0.min.js"></script>

<!-- SRI: hash mismatch causes the browser to block it -->
<script
  src="https://code.jquery.com/jquery-3.6.0.min.js"
  integrity="sha256-/xUj+3OJU5yExlq6GSYGSHk7tPXikynS7ogEvDej/m4="
  crossorigin="anonymous">
</script>
```

### Line of reasoning in code

Check `<script>` and `<link>` tags loading from external URLs for the `integrity` attribute. Particularly:
- CSS frameworks (Bootstrap, Tailwind CDN)
- JavaScript libraries (jQuery, Chart.js)
- Font service scripts

---

## Questions to Use During Review

1. **Is user-submitted data being deserialized?** pickle and Java serialization must not receive user input.
2. **Is `yaml.load` in use anywhere?** Should be `yaml.safe_load`.
3. **Does any object merge process using user input exclude `__proto__` keys?**
4. **Do externally loaded scripts have SRI hashes?** Set correctly on new additions and version changes?

---

## References

- OWASP Deserialization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html
- OWASP A08:2025 Software or Data Integrity Failures: https://owasp.org/Top10/2025/A08_2025-Software_or_Data_Integrity_Failures/
- MDN Subresource Integrity: https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
- Prototype Pollution (PortSwigger): https://portswigger.net/web-security/prototype-pollution
- CWE-502 (Deserialization of Untrusted Data): https://cwe.mitre.org/data/definitions/502.html
