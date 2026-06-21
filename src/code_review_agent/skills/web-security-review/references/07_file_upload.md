# 07 File Upload & Path Traversal (The Dual Nature of Files)

## Contents
- Root cause
- File upload: controlling what gets uploaded
- Path traversal: path as input
- Questions to use during review
- References

## Root Cause

File upload carries elevated risk because files are simultaneously **data and potentially executable**.

Injecting text input and having it executed as a command is called injection — clearly a problem. Uploading a PHP file and having it executed, or embedding a script in an SVG and having it execute, shares the same structure, but reads as "implementing a file upload feature" — a benign-seeming action.

Path traversal is a related but distinct problem. When a "filename" is user input, it is potentially an instruction to the filesystem. `../../../etc/passwd` is a command: "move up to the root and read this file."

---

## File Upload: Controlling What Gets Uploaded

### Mechanism of impact

Damage from uploaded files escalates in stages:

1. **Executable file upload → RCE**: uploading `.php`/`.py`/`.rb` under the web root and accessing the URL directly to execute it
2. **XSS payload in file → Stored XSS**: SVG is XML and can contain scripts; HTML files likewise. If an SVG is served as `Content-Type: image/svg+xml`, embedded scripts execute as XSS
3. **Oversized file → DoS**: without a size limit, storage exhaustion or memory pressure becomes a denial-of-service vector

Understanding the limits of MIME type validation is critical. **The Content-Type header is set by the client — attackers can freely modify it.** Sending a PHP file with `Content-Type: image/jpeg` has no technical barrier.

### Line of reasoning in code

Ask not "what is being checked?" but "what does that check actually prevent?":

```javascript
// Checking Content-Type only → bypassable
if (file.mimetype !== 'image/jpeg') {
  return res.status(400).json({ error: 'Invalid type' });
}
// Attacker: sends PHP file with Content-Type: image/jpeg → passes

// Checking extension only → bypassable with double extension
const ext = path.extname(file.originalname);
if (ext !== '.jpg') { reject(); }
// Attacker: shell.php.jpg → extension is .jpg, content is PHP

// Magic byte checking comes closer, but:
// JPEG: FF D8 FF   PNG: 89 50 4E 47   GIF: 47 49 46 38
// Magic bytes can also be forged (prepended to payload)

// The fundamental defense: isolation from execution
const uploadDir = '/var/uploads/';  // outside the web root
// And: serve downloads by piping through the server, not direct URL access
```

**Treat original filenames as attacker-controlled input.** Using them in save paths enables path traversal. Excessively long filenames can also overflow filesystem limits or DB column lengths.

```javascript
// Dangerous: using original filename in path
const savePath = path.join(uploadDir, file.originalname);
// originalname = '../../etc/crontab' → writes to arbitrary path

// Safe: generate a new filename
const savedName = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
const savePath = path.join(uploadDir, savedName);
```

---

## Path Traversal: The Danger of "Path" as Input

### Mechanism of impact

When `../` appears in a path, it navigates up the directory tree. An attacker can traverse to any file the web server process has read access to:

```
/var/www/html/uploads/../../../etc/passwd
→ /etc/passwd
```

A critical misconception: `path.join()` **resolves** `..` rather than removing it. It walks the directory tree as specified:

```javascript
> path.join('/var/www/uploads', '../../etc/passwd')
'/etc/passwd'  // join resolves .., it does not strip it
```

### Line of reasoning in code

Look for user-supplied values entering filesystem paths:

```javascript
// Any of these can be exploited
const filename = req.params.filename;     // ?filename=../../etc/passwd
const filePath = path.join(baseDir, filename);

// Fundamental defense: check the resolved path stays inside the base directory
const resolved = path.resolve(baseDir, filename);
if (!resolved.startsWith(path.resolve(baseDir) + path.sep)) {
  return res.status(400).json({ error: 'Invalid path' });
}
// path.sep is the OS path separator (/ or \)
// The + path.sep prevents the base directory itself from matching a prefix attack
```

---

## Questions to Use During Review

1. **Can uploaded files be stored where the web server can execute them?** Check both the path and the server configuration.
2. **What is the file type check trusting?** Content-Type cannot be trusted.
3. **Is the save-time filename derived from user input?** Path traversal potential.
4. **At download time, does a user-specified path map directly to a filesystem access?**

---

## References

- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
- PortSwigger File Upload Vulnerabilities: https://portswigger.net/web-security/file-upload
- CWE-22 (Path Traversal): https://cwe.mitre.org/data/definitions/22.html
- CWE-434 (Unrestricted Upload of File with Dangerous Type): https://cwe.mitre.org/data/definitions/434.html
