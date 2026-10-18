// 组装 Windows 便携包（CrossPet 那种：解压 → 双击 install.cmd）
// 前置：先跑 `npm run tauri build`，本脚本只负责收集产物与脚本
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = join(HERE, '..');
const releaseDir = join(root, 'app/src-tauri/target/release');
const outDir = join(root, 'release/buddy-windows-portable');

if (!existsSync(releaseDir)) {
  console.error('找不到 release 目录，先执行：cd app && npm run tauri build');
  process.exit(1);
}

// 取主程序：排除 install/uninstall 之类的辅助 exe
const exes = readdirSync(releaseDir)
  .filter((f) => f.toLowerCase().endsWith('.exe'))
  .filter((f) => !/setup|install|uninstall/i.test(f))
  .map((f) => join(releaseDir, f));

if (exes.length === 0) {
  console.error('release 目录里没有可执行文件');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const exe = exes.sort((a, b) => statSync(b).size - statSync(a).size)[0];
copyFileSync(exe, join(outDir, 'Buddy.exe'));

for (const f of ['install.cmd', 'uninstall.cmd', 'README.txt']) {
  copyFileSync(join(root, 'packaging', f), join(outDir, f));
}

const icon = join(root, 'app/src-tauri/icons/icon.ico');
if (existsSync(icon)) copyFileSync(icon, join(outDir, 'buddy.ico'));

const mb = (statSync(join(outDir, 'Buddy.exe')).size / 1024 / 1024).toFixed(1);
writeFileSync(
  join(outDir, 'VERSION.txt'),
  `Buddy ${JSON.parse(readFileSync(join(root, 'app/package.json'), 'utf8')).version}\nbuilt ${new Date().toISOString()}\n`,
);

console.log(`便携包就绪：release/buddy-windows-portable（${basename(exe)}，${mb} MB）`);
console.log('打成 zip：tar -a -c -f release/buddy-windows-portable.zip -C release buddy-windows-portable');
