import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const pagePath = path.resolve("app/src/main/assets/iphone/index.html");
const html = fs.readFileSync(pagePath, "utf8");
const cspMatch = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i);
const scriptMatch = html.match(/<script\s+data-csp-hash[^>]*>([\s\S]*?)<\/script>/i);

if (!cspMatch) {
  throw new Error("Missing Content-Security-Policy meta tag");
}
if (!scriptMatch) {
  throw new Error("Missing inline script marked with data-csp-hash");
}

const script = scriptMatch[1];
const hash = crypto.createHash("sha256").update(script, "utf8").digest("base64");
if (!cspMatch[0].includes(`'sha256-${hash}'`)) {
  throw new Error(`CSP hash mismatch: expected sha256-${hash}`);
}

new vm.Script(script, { filename: pagePath });

for (const requiredApi of [
  "window.YingshiVoice",
  "exactVoiceMatch",
  "playVod",
  "playLive",
]) {
  if (!script.includes(requiredApi)) {
    throw new Error(`Missing voice bridge marker: ${requiredApi}`);
  }
}

console.log(`Bundled page OK: ${pagePath}`);
console.log(`Inline script SHA-256: ${hash}`);
