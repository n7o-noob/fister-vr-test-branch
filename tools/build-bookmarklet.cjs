// Strips full-line comments and indentation (no multi-line strings in the source), then URL-encodes.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const body = src.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//')).join('\n');
new Function(body); // syntax check
const url = 'javascript:' + encodeURIComponent(body + '\nvoid 0;');
fs.writeFileSync(process.argv[3], url);
console.log('bookmarklet bytes', url.length, 'code bytes', body.length);
