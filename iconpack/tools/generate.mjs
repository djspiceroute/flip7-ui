// Turns the line drawings in icons/ into the four icon-pack flavors:
// adaptive icons (tile + glyph) as Android vector drawables, the appfilter
// that maps app components to them, and an SVG preview sheet per flavor.
//
//   npm install && node generate.mjs
//
// Everything under src/<flavor>/ and preview/ is generated; edit icons/ and
// apps.json instead, then run import-arcticons.mjs and this script.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const packDir = path.resolve(toolsDir, '..');
const iconsDir = path.join(packDir, 'icons');

// [tile, glyph] colors. Jewel picks one gem per icon, stable by name.
const FINISHES = {
  hingeLine: { label: 'Hinge Line', mask: 'squircle', tiles: [['#1A1C20', '#F2F2EE']] },
  hingeSolid: { label: 'Hinge Solid', mask: 'squircle', tiles: [['#C6F432', '#0F1012']] },
  aurelleJewel: {
    label: 'Aurelle Jewel',
    mask: 'circle',
    tiles: [['#D4F0E1', '#036C49'], ['#FFDFDF', '#A12437'], ['#DCE9FF', '#2454B3'], ['#F0E2F9', '#78389A'], ['#EEE9CE', '#22201C']],
  },
  aurelleGilt: { label: 'Aurelle Gilt', mask: 'circle', tiles: [['#191816', '#D8AE55']] },
};

// Drawings use a 48-unit grid. On the 108dp adaptive canvas they are scaled
// to stay inside the 66dp safe zone, so any launcher mask keeps them whole.
const CANVAS = 108;
const GLYPH_SCALE = 1.35;
const GLYPH_OFFSET = (CANVAS - 48 * GLYPH_SCALE) / 2;
// Arcticons draws 1-unit hairlines; this weight matches the mockups.
const STROKE_WEIGHT = 1.6;

const fmt = (n) => String(+n.toFixed(3));

// --- SVG reading -----------------------------------------------------------

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', preserveOrder: true });

const tagOf = (node) => Object.keys(node).find((k) => k !== ':@');

function parseCss(text) {
  const rules = [];
  for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = parseDecls(m[2]);
    for (const sel of m[1].split(',')) {
      const s = sel.trim();
      if (/^\.[\w-]+$/.test(s)) rules.push({ cls: s.slice(1), decls });
    }
  }
  return rules;
}

function parseDecls(text) {
  const out = {};
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const PRESENTATION = ['fill', 'stroke', 'stroke-width', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'opacity'];

// Cascade: inherited < presentation attributes < class rules < inline style.
function resolveStyle(attrs, inherited, rules) {
  const style = { ...inherited };
  for (const p of PRESENTATION) if (attrs[p] != null) style[p] = attrs[p];
  const classes = (attrs.class ?? '').split(/\s+/).filter(Boolean);
  for (const r of rules) if (classes.includes(r.cls)) Object.assign(style, r.decls);
  if (attrs.style) Object.assign(style, parseDecls(attrs.style));
  return style;
}

const nums = (s) => (s ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);

function parseTransform(str) {
  const groups = [];
  for (const m of (str ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const [fn, a] = [m[1], nums(m[2])];
    if (fn === 'translate') groups.push({ tx: a[0], ty: a[1] ?? 0 });
    else if (fn === 'scale') groups.push({ sx: a[0], sy: a[1] ?? a[0] });
    else if (fn === 'rotate') groups.push({ rot: a[0], px: a[1] ?? 0, py: a[2] ?? 0 });
    else if (fn === 'matrix') {
      const [ma, mb, mc, md, me, mf] = a;
      const sx = Math.hypot(ma, mb);
      const sy = (ma * md - mb * mc) / sx;
      if (Math.abs(ma * mc + mb * md) > 1e-6 * sx * Math.abs(sy)) throw new Error(`skewed matrix(${m[2]}) is not supported`);
      groups.push({ tx: me, ty: mf, rot: (Math.atan2(mb, ma) * 180) / Math.PI, sx, sy });
    } else throw new Error(`transform ${fn}() is not supported`);
  }
  return groups;
}

// Rewrites path data with explicit separators. Android's parser has trouble
// with compact arc flags ("a1 1 0 011 1"), which SVG allows.
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
function normalizePath(d) {
  const out = [];
  const numRe = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  let i = 0;
  let cmd = null;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const readNum = () => {
    skip();
    numRe.lastIndex = i;
    const m = numRe.exec(d);
    if (!m) throw new Error(`bad path data near "${d.slice(i, i + 12)}"`);
    i = numRe.lastIndex;
    return fmt(parseFloat(m[0]));
  };
  const readFlag = () => {
    skip();
    const f = d[i++];
    if (f !== '0' && f !== '1') throw new Error(`bad arc flag near "${d.slice(i - 1, i + 11)}"`);
    return f;
  };
  for (skip(); i < d.length; skip()) {
    if (/[a-zA-Z]/.test(d[i])) {
      cmd = d[i++];
      if (!(cmd.toLowerCase() in ARGS)) throw new Error(`unknown path command ${cmd}`);
      out.push(cmd);
      if (cmd.toLowerCase() === 'z') continue;
    } else if (!cmd || cmd.toLowerCase() === 'z') {
      throw new Error(`path data without a command near "${d.slice(i, i + 12)}"`);
    }
    const n = ARGS[cmd.toLowerCase()];
    const args = [];
    for (let k = 0; k < n; k++) args.push(cmd.toLowerCase() === 'a' && (k === 3 || k === 4) ? readFlag() : readNum());
    out.push(args.join(' '));
  }
  return out.join(' ');
}

function rectPath(x, y, w, h, rx, ry) {
  if (!rx && !ry) return `M${x},${y}h${w}v${h}h${-w}Z`;
  rx = Math.min(rx || ry, w / 2);
  ry = Math.min(ry || rx, h / 2);
  return `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`;
}

const ellipsePath = (cx, cy, rx, ry) =>
  `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`;

function shapeToPath(tag, a) {
  const n = (k) => parseFloat(a[k] ?? 0);
  switch (tag) {
    case 'path': return a.d;
    case 'circle': return ellipsePath(n('cx'), n('cy'), n('r'), n('r'));
    case 'ellipse': return ellipsePath(n('cx'), n('cy'), n('rx'), n('ry'));
    case 'line': return `M${n('x1')},${n('y1')}L${n('x2')},${n('y2')}`;
    case 'rect': return rectPath(n('x'), n('y'), n('width'), n('height'), n('rx'), n('ry'));
    case 'polyline':
    case 'polygon': {
      const p = nums(a.points);
      let d = `M${p[0]},${p[1]}`;
      for (let k = 2; k < p.length; k += 2) d += `L${p[k]},${p[k + 1]}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
  }
  return null;
}

const SKIP = new Set(['defs', 'style', 'title', 'desc', 'metadata', '#text']);

// Reads one drawing into a tree of groups and paths. Colors are left out:
// every painted part takes the finish's glyph color.
function readGlyph(file) {
  const doc = parser.parse(fs.readFileSync(file, 'utf8'));
  const svgNode = doc.find((n) => tagOf(n) === 'svg');
  if (!svgNode) throw new Error(`${file}: no <svg> element`);

  let css = '';
  const collectCss = (nodes) => {
    for (const node of nodes) {
      const tag = tagOf(node);
      if (tag === 'style') css += node.style.map((t) => t['#text'] ?? '').join('');
      else if (tag !== '#text' && Array.isArray(node[tag])) collectCss(node[tag]);
    }
  };
  collectCss(svgNode.svg);
  const rules = parseCss(css);

  const [vx, vy, vw] = nums(svgNode[':@']?.viewBox ?? '0 0 48 48');

  const walk = (nodes, inherited) => {
    const out = [];
    for (const node of nodes) {
      const tag = tagOf(node);
      if (SKIP.has(tag)) continue;
      const attrs = node[':@'] ?? {};
      const style = resolveStyle(attrs, inherited, rules);
      let item;
      if (tag === 'g') {
        item = { children: walk(node.g, style) };
      } else {
        const d = shapeToPath(tag, attrs);
        if (d == null) throw new Error(`${path.basename(file)}: <${tag}> is not supported`);
        const fill = style.fill ?? '#000';
        const stroke = style.stroke ?? 'none';
        const sw = parseFloat(style['stroke-width'] ?? '1');
        item = {
          path: normalizePath(d),
          fill: fill !== 'none',
          stroke: stroke !== 'none' && sw > 0 ? sw * STROKE_WEIGHT : 0,
          cap: style['stroke-linecap'] ?? 'butt',
          join: style['stroke-linejoin'] ?? 'miter',
          evenOdd: style['fill-rule'] === 'evenodd',
        };
        if (!item.fill && !item.stroke) continue;
      }
      // An element's own transforms wrap it, outermost first.
      for (const t of parseTransform(attrs.transform).reverse()) item = { ...t, children: [item] };
      out.push(item);
    }
    return out;
  };

  const s = (48 / vw) * GLYPH_SCALE;
  return { tx: GLYPH_OFFSET - vx * s, ty: GLYPH_OFFSET - vy * s, sx: s, sy: s, children: walk(svgNode.svg, {}) };
}

// --- Output ----------------------------------------------------------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function vectorXml(tree, color) {
  const lines = [];
  const emit = (node, depth) => {
    const pad = '    '.repeat(depth);
    if (node.path) {
      const attrs = [`android:pathData="${node.path}"`];
      if (node.fill) attrs.push(`android:fillColor="${color}"`);
      if (node.evenOdd) attrs.push('android:fillType="evenOdd"');
      if (node.stroke) {
        attrs.push(`android:strokeColor="${color}"`, `android:strokeWidth="${fmt(node.stroke)}"`);
        if (node.cap !== 'butt') attrs.push(`android:strokeLineCap="${node.cap}"`);
        if (node.join !== 'miter') attrs.push(`android:strokeLineJoin="${node.join}"`);
      }
      lines.push(`${pad}<path\n${attrs.map((a) => `${pad}    ${a}`).join('\n')} />`);
      return;
    }
    const attrs = [];
    if (node.tx || node.ty) attrs.push(`android:translateX="${fmt(node.tx ?? 0)}"`, `android:translateY="${fmt(node.ty ?? 0)}"`);
    if (node.rot) attrs.push(`android:rotation="${fmt(node.rot)}"`);
    if (node.px || node.py) attrs.push(`android:pivotX="${fmt(node.px ?? 0)}"`, `android:pivotY="${fmt(node.py ?? 0)}"`);
    if (node.sx != null && (node.sx !== 1 || node.sy !== 1)) attrs.push(`android:scaleX="${fmt(node.sx)}"`, `android:scaleY="${fmt(node.sy)}"`);
    lines.push(`${pad}<group${attrs.map((a) => ' ' + a).join('')}>`);
    for (const c of node.children) emit(c, depth + 1);
    lines.push(`${pad}</group>`);
  };
  emit(tree, 1);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Generated by iconpack/tools/generate.mjs. Do not edit. -->',
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${CANVAS}dp"`,
    `    android:height="${CANVAS}dp"`,
    `    android:viewportWidth="${CANVAS}"`,
    `    android:viewportHeight="${CANVAS}">`,
    ...lines,
    '</vector>',
    '',
  ].join('\n');
}

// Same tree as SVG, for the preview sheets. A vector group applies scale,
// then rotation (both about the pivot), then translation.
function svgGroup(node, color) {
  if (node.path) {
    const a = [`d="${node.path}"`, `fill="${node.fill ? color : 'none'}"`];
    if (node.evenOdd) a.push('fill-rule="evenodd"');
    if (node.stroke) a.push(`stroke="${color}"`, `stroke-width="${fmt(node.stroke)}"`, `stroke-linecap="${node.cap}"`, `stroke-linejoin="${node.join}"`);
    return `<path ${a.join(' ')}/>`;
  }
  const px = node.px ?? 0;
  const py = node.py ?? 0;
  const t = [
    `translate(${fmt((node.tx ?? 0) + px)} ${fmt((node.ty ?? 0) + py)})`,
    node.rot ? `rotate(${fmt(node.rot)})` : '',
    node.sx != null ? `scale(${fmt(node.sx)} ${fmt(node.sy)})` : '',
    px || py ? `translate(${fmt(-px)} ${fmt(-py)})` : '',
  ].filter(Boolean).join(' ');
  return `<g transform="${t}">${node.children.map((c) => svgGroup(c, color)).join('')}</g>`;
}

function hashIndex(name, n) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % n;
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const { icons, components } = JSON.parse(fs.readFileSync(path.join(iconsDir, 'icons.json'), 'utf8'));
const glyphs = new Map();
for (const icon of [...icons, { drawable: 'pack_icon', glyph: 'custom/pack_icon.svg' }]) {
  glyphs.set(icon.drawable, readGlyph(path.join(iconsDir, icon.glyph)));
}

const byLabel = [...icons].sort((a, b) => a.label.localeCompare(b.label));
const appfilter = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!-- Generated by iconpack/tools/generate.mjs. Do not edit. -->',
  '<resources>',
  ...byLabel.flatMap((icon) => {
    const comps = components.filter((c) => c.drawable === icon.drawable);
    if (!comps.length) return [];
    return [`    <!-- ${esc(icon.label)} -->`, ...comps.map((c) => `    <item component="${esc(c.component)}" drawable="${icon.drawable}" />`)];
  }),
  '</resources>',
  '',
].join('\n');
const drawableList = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!-- Generated by iconpack/tools/generate.mjs. Do not edit. -->',
  '<resources>',
  '    <version>1</version>',
  '    <category title="Apps" />',
  ...byLabel.map((icon) => `    <item drawable="${icon.drawable}" />`),
  '</resources>',
  '',
].join('\n');

for (const [flavor, finish] of Object.entries(FINISHES)) {
  const dir = path.join(packDir, 'src', flavor);
  fs.rmSync(dir, { recursive: true, force: true });

  const tileOf = (name) => (finish.tiles.length === 1 ? 0 : hashIndex(name, finish.tiles.length));
  writeFile(path.join(dir, 'res/values/tiles.xml'), [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- Generated by iconpack/tools/generate.mjs. Do not edit. -->',
    '<resources>',
    ...finish.tiles.map(([tile], i) => `    <color name="tile_${i}">${tile}</color>`),
    '</resources>',
    '',
  ].join('\n'));

  for (const [name, tree] of glyphs) {
    const t = tileOf(name);
    writeFile(path.join(dir, `res/drawable/${name}_fg.xml`), vectorXml(tree, finish.tiles[t][1]));
    writeFile(path.join(dir, `res/drawable/${name}.xml`), [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<!-- Generated by iconpack/tools/generate.mjs. Do not edit. -->',
      '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
      `    <background android:drawable="@color/tile_${t}" />`,
      `    <foreground android:drawable="@drawable/${name}_fg" />`,
      `    <monochrome android:drawable="@drawable/${name}_fg" />`,
      '</adaptive-icon>',
      '',
    ].join('\n'));
  }
  writeFile(path.join(dir, 'res/xml/appfilter.xml'), appfilter);
  writeFile(path.join(dir, 'assets/appfilter.xml'), appfilter);
  writeFile(path.join(dir, 'res/xml/drawable.xml'), drawableList);

  // Preview sheet: the icons masked the way a launcher would show them.
  const cols = 10;
  const cell = 132;
  const rows = Math.ceil(byLabel.length / cols);
  const clip = finish.mask === 'circle'
    ? `<circle cx="54" cy="54" r="54"/>`
    : `<path d="M54 0C10 0 0 10 0 54s10 54 54 54 54-10 54-54S98 0 54 0Z"/>`;
  const cells = byLabel.map((icon, i) => {
    const t = tileOf(icon.drawable);
    const [tile, glyph] = finish.tiles[t];
    const x = (i % cols) * cell + 12;
    const y = Math.floor(i / cols) * (cell + 18) + 12;
    return `<g transform="translate(${x} ${y})"><g clip-path="url(#m)"><rect width="108" height="108" fill="${tile}"/>${svgGroup(glyphs.get(icon.drawable), glyph)}</g>` +
      `<text x="54" y="126" font-family="system-ui,sans-serif" font-size="11" text-anchor="middle" fill="#5E5A52">${esc(icon.label.length > 18 ? icon.label.slice(0, 17) + '…' : icon.label)}</text></g>`;
  });
  writeFile(path.join(packDir, 'preview', `${flavor}.svg`), [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell + 12}" height="${rows * (cell + 18) + 12}" viewBox="0 0 ${cols * cell + 12} ${rows * (cell + 18) + 12}">`,
    `<defs><clipPath id="m">${clip}</clipPath></defs>`,
    `<rect width="100%" height="100%" fill="#EDEAE3"/>`,
    ...cells,
    '</svg>',
    '',
  ].join('\n'));
}

console.log(`${icons.length} icons × ${Object.keys(FINISHES).length} finishes, ${components.length} components`);
