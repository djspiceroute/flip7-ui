// Pulls the launcher components and line drawings for the apps in apps.json
// out of an Arcticons checkout, and writes icons/icons.json plus the SVGs in
// icons/arcticons/. Run again whenever apps.json changes.
//
//   node import-arcticons.mjs /path/to/Arcticons
//
// The checkout needs app/src/main/assets/appfilter.xml and icons/white/*.svg
// (a sparse checkout of those two paths is enough).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(toolsDir, '../icons');
const arcticonsDir = process.argv[2];
if (!arcticonsDir) {
  console.error('usage: node import-arcticons.mjs /path/to/Arcticons');
  process.exit(1);
}

const { apps } = JSON.parse(fs.readFileSync(path.join(toolsDir, 'apps.json'), 'utf8'));
const appfilter = fs.readFileSync(path.join(arcticonsDir, 'app/src/main/assets/appfilter.xml'), 'utf8');

const byPackage = new Map();
for (const m of appfilter.matchAll(/component="ComponentInfo\{([^/}]+)\/([^}]+)\}"\s+drawable="([^"]+)"/g)) {
  const [, pkg, activity, drawable] = m;
  if (!byPackage.has(pkg)) byPackage.set(pkg, []);
  byPackage.get(pkg).push({ component: `ComponentInfo{${pkg}/${activity}}`, drawable });
}

const icons = new Map();      // drawable -> { drawable, label, glyph }
const components = new Map(); // component -> drawable
const missing = [];

function addIcon(drawable, label, glyph) {
  if (!icons.has(drawable)) icons.set(drawable, { drawable, label, glyph });
}

for (const app of apps) {
  const entries = app.package ? byPackage.get(app.package) ?? [] : [];
  if (app.package && entries.length === 0) missing.push(`${app.label} (${app.package})`);

  if (app.drawable) {
    const glyph = app.glyph === 'custom' ? `custom/${app.drawable}.svg` : `arcticons/${app.glyph ?? app.drawable}.svg`;
    addIcon(app.drawable, app.label, glyph);
    for (const e of entries) components.set(e.component, app.drawable);
  } else {
    // Only the app's main drawing is kept: Arcticons also maps some
    // components to modded or aliased apps (ReVanced, microG, ...) that would
    // otherwise leak in under the wrong label. 'main' picks it when the most
    // common drawing is not the right one.
    const counts = new Map();
    for (const e of entries) counts.set(e.drawable, (counts.get(e.drawable) ?? 0) + 1);
    const main = app.main ?? [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!main) continue;
    addIcon(main, app.label, `arcticons/${main}.svg`);
    for (const e of entries) if (e.drawable === main) components.set(e.component, main);
  }
}

fs.mkdirSync(path.join(iconsDir, 'arcticons'), { recursive: true });
for (const f of fs.readdirSync(path.join(iconsDir, 'arcticons'))) fs.rmSync(path.join(iconsDir, 'arcticons', f));
for (const icon of icons.values()) {
  if (!icon.glyph.startsWith('arcticons/')) continue;
  const name = path.basename(icon.glyph);
  const src = path.join(arcticonsDir, 'icons/white', name);
  if (!fs.existsSync(src)) throw new Error(`Arcticons has no drawing ${name} (needed for ${icon.label})`);
  fs.copyFileSync(src, path.join(iconsDir, 'arcticons', name));
}

const out = {
  icons: [...icons.values()].sort((a, b) => a.drawable.localeCompare(b.drawable)),
  components: [...components].map(([component, drawable]) => ({ component, drawable })).sort((a, b) => a.component.localeCompare(b.component)),
};
fs.writeFileSync(path.join(iconsDir, 'icons.json'), JSON.stringify(out, null, 2) + '\n');

console.log(`${out.icons.length} icons, ${out.components.length} components`);
if (missing.length) console.log(`No Arcticons components for: ${missing.join(', ')}`);
