import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import crypto from 'node:crypto';
const androidRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = path.dirname(androidRoot);
const candidates = [process.env.TV_CLOUD_SOURCE, parent, path.join(parent, 'cloud'), path.resolve(androidRoot, '../..')].filter(Boolean);
let cloudRoot;
for (const candidate of candidates) {
  if (await fs.stat(path.join(candidate, 'docs/iphone/index.html')).then(() => true).catch(() => false)) { cloudRoot = path.resolve(candidate); break; }
}
if (!cloudRoot) throw new Error('Set TV_CLOUD_SOURCE to the TV repository root');
const uiRoot = path.join(cloudRoot, 'docs/iphone');
const assets = path.join(androidRoot, 'app/src/main/assets');
await fs.mkdir(path.join(assets, 'iphone'), { recursive: true });
let html = (await fs.readFile(path.join(uiRoot, 'index.html'), 'utf8')).replace(/\r\n/g, '\n');
const source = html.match(/<script type="module" data-csp-hash>([\s\S]*?)<\/script>/)?.[1];
if (!source) throw new Error('Cloud application module missing');
const imports = [...source.matchAll(/^\s*import .+?;\s*$/gm)].map(match => match[0]).join('\n');
const body = source.replace(/^\s*import .+?;\s*$/gm, '');
const result = await build({ stdin: { contents: `${imports}\nasync function bootCar(){${body}\n}\nbootCar().catch(error => { console.error('cloud-boot-failed', error.message); try { window.CarBridge?.onAppError?.(error.message); } catch {} });`, resolveDir: uiRoot, sourcefile: 'car-entry.js' }, bundle: true, format: 'iife', target: 'chrome89', write: false, charset: 'utf8', legalComments: 'inline' });
const script = '\n' + result.outputFiles[0].text.replaceAll('</script', '<\\/script') + '\n';
html = html.replace(/<script type="module" data-csp-hash>[\s\S]*?<\/script>/, `<script data-csp-hash>${script}</script>`);
const controlsCss = await fs.readFile(path.join(uiRoot, 'player-controls.css'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="\.\/player-controls.css"\s*\/>/, '');
html = html.replace(/<link rel="modulepreload"[^>]+>/g, '');
html = html.replace('</style>', `\n${controlsCss}\n</style>`);
for (const [lib, file] of [['hls.js', 'hls.min.js'], ['pako', 'pako.min.js']]) {
  html = html.replace(new RegExp(`<script src="https://cdn\\.jsdelivr\\.net/npm/${lib.replace('.', '\\.')}@[^\"]+"[^>]*><\\/script>`), `<script src="../assets/${file}"></script>`);
  await fs.copyFile(path.join(androidRoot, 'node_modules', lib, 'dist', file), path.join(assets, 'iphone', file));
  await fs.copyFile(path.join(androidRoot, 'node_modules', lib, 'LICENSE'), path.join(assets, 'iphone', `${lib}.LICENSE`));
}
const sha = value => crypto.createHash('sha256').update(value).digest('base64');
const style = html.match(/<style\s+data-csp-hash>([\s\S]*?)<\/style>/)[1];
const policy = ["default-src 'self'", `script-src 'self' 'sha256-${sha(script)}' https://www.youtube.com`, `style-src 'self' 'sha256-${sha(style)}'`, "img-src 'self' data: https:", "media-src 'self' blob: https:", "connect-src 'self' https:", 'frame-src https://www.youtube.com https://www.youtube-nocookie.com', "worker-src 'self' blob:", "font-src 'self' data:", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
html = html.replace(/(<meta http-equiv="Content-Security-Policy" data-oktv-csp content=")[^"]+("\s*\/?>)/, `$1${policy}$2`);
html = html.replace('<title>影視 OKTV iPhone</title>', '<title>影視 雲端版</title>');
await fs.writeFile(path.join(assets, 'iphone/index.html'), html);
// Only executable UI/libraries/icons go into the APK. All catalogs, subtitles,
// source addresses, search shards and media are fetched at runtime.
for (const name of ['icon.png', 'source-signal-icon.svg', 'adult-18-badge.svg']) {
  await fs.copyFile(path.join(cloudRoot, 'docs/assets', name), path.join(assets, 'iphone', name));
}
const forbidden = [];
async function audit(folder) { for (const entry of await fs.readdir(folder, { withFileTypes: true })) { const file = path.join(folder, entry.name); if (entry.isDirectory()) await audit(file); else if (/\.(?:json|gz|m3u8?|mp4|ts|vtt|srt)$/i.test(entry.name)) forbidden.push(file); } }
await audit(assets);
if (forbidden.length) throw new Error(`Source/media data must not be packaged: ${forbidden.join(', ')}`);
console.log(JSON.stringify({ cloudRoot, uiBytes: Buffer.byteLength(html), sourceDataFiles: 0, scriptSha256: sha(script) }));
