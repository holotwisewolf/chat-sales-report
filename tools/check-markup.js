// Markup sanity check: verifies every class in JS-generated HTML has styles, and flags id lookups
// that no longer match any element. Run: node tools/check-markup.js
// Catches the "styles target .dataTable but the element is #dataTable" class of silent bug.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const jsFiles = fs.readdirSync(path.join(root, 'public')).filter(f => f.endsWith('.js'));
const js = jsFiles.map(f => fs.readFileSync(path.join(root, 'public', f), 'utf8')).join('\n');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

// Classes: static markup, template-literal markup, and JS assignments.
const used = new Set();
for (const m of (js + html).matchAll(/class="([^"${}]+)"/g)) m[1].split(/\s+/).forEach(c => /^[a-zA-Z][\w-]*$/.test(c) && used.add(c));
for (const m of js.matchAll(/className\s*=\s*'([^']+)'/g)) m[1].split(/\s+/).forEach(c => used.add(c));
for (const m of js.matchAll(/classList\.(?:add|toggle|remove)\('([^']+)'\)/g)) used.add(m[1]);

const styled = new Set();
for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) styled.add(m[1]);

// ids injected at runtime (rendered inside template strings), so they are not expected in index.html
const injected = new Set([...js.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

const unstyled = [...used].filter(c => !styled.has(c)).sort();
const idsNeeded = new Set([...js.matchAll(/['`]#([a-zA-Z][\w-]*)['`]/g)].map(m => m[1]));
const idsPresent = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const missingIds = [...idsNeeded].filter(id => !idsPresent.has(id) && !injected.has(id) && !/^[0-9a-f]{3,8}$/i.test(id)).sort();

let fail = false;
if (unstyled.length) { fail = true; console.log('classes used but never styled:'); unstyled.forEach(c => console.log('  .' + c)); }
if (missingIds.length) { fail = true; console.log('id lookups with no element anywhere:'); missingIds.forEach(i => console.log('  #' + i)); }
if (!fail) console.log('markup check clean - every used class is styled, every id lookup resolves');
process.exit(fail ? 1 : 0);
