// 构建单文件原型：注入 Blender 环轨迹 + 把球体/卫星渲染图内联成 data URI
// 预览面板只服务单个 HTML，所以资源必须内联
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = join(HERE, '..');
const STATES = ['idle', 'working', 'attention', 'stalled', 'completed', 'offline'];
const MATS = ['pearl', 'chrome', 'frosted', 'ceramic', 'carbon', 'amber',
              'copper', 'water', 'brushed', 'marble', 'stone'];

const ring = JSON.parse(readFileSync(join(root, 'assets/buddy/ring-path.json'), 'utf8'));
const flat = ring.points.map((p) => [p.x, p.y, p.near ? 1 : 0]);

const dataUri = (f) => 'data:image/png;base64,' + readFileSync(f).toString('base64');

const images = {};
for (const s of STATES) images[s] = dataUri(join(root, `assets/buddy/buddy-${s}.png`));

const sats = {};
for (const m of MATS) sats[m] = dataUri(join(root, `assets/sat/sat-${m}.png`));

const tpl = readFileSync(join(HERE, '_template.html'), 'utf8');
const out = tpl
  .replace('__RING_PATH__', JSON.stringify(flat))
  .replace('__STATE_IMAGES__', JSON.stringify(images))
  .replace('__SAT_IMAGES__', JSON.stringify(sats));

const dest = join(HERE, 'buddy-credit-float.html');
writeFileSync(dest, out);
console.log(
  `built ${(statSync(dest).size / 1024).toFixed(0)} KB · ring ${flat.length} pts · states ${STATES.length} · satellites ${MATS.length}`
);
