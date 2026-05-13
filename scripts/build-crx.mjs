#!/usr/bin/env node
// Build a signed CRX3 from dist/ plus an updates.xml for self-hosted updates.
// Inputs:
//   - dist/ folder produced by `npm run build`
//   - CRX_PRIVATE_KEY env var containing the PEM-encoded private key
// Outputs (in pages/):
//   - tempo-auto-logger.crx
//   - updates.xml
//
// The extension ID is derived from the public key. We hardcode the expected ID
// here so a key mismatch fails loudly instead of silently shipping a new
// extension that teammates can't auto-update to.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ChromeExtension from 'crx';

const EXPECTED_ID = 'lllmnccgpmaohmachieeindoelkaaood';
const REPO_OWNER = 'kristapsk123';
const REPO_NAME = 'tempo-auto-logger';
const CRX_NAME = 'tempo-auto-logger.crx';
const PAGES_BASE = `https://${REPO_OWNER}.github.io/${REPO_NAME}`;

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');
const distDir = join(repoRoot, 'dist');
const outDir = join(repoRoot, 'pages');

const pem = process.env.CRX_PRIVATE_KEY;
if (!pem) {
  console.error('CRX_PRIVATE_KEY env var is empty.');
  process.exit(1);
}

function computeIdFromPem(pemString) {
  const pub = createPublicKey(pemString)
    .export({ type: 'spki', format: 'der' });
  const hex = createHash('sha256').update(pub).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

const actualId = computeIdFromPem(pem);
if (actualId !== EXPECTED_ID) {
  console.error(
    `Key mismatch: expected extension ID ${EXPECTED_ID}, got ${actualId}.`,
  );
  console.error('Refusing to build — this key would produce a different ID');
  console.error('than the one teammates have policy-pinned. Update the secret');
  console.error('or update EXPECTED_ID in scripts/build-crx.mjs.');
  process.exit(1);
}

const version = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
).version;

mkdirSync(outDir, { recursive: true });

const crx = new ChromeExtension({ privateKey: Buffer.from(pem, 'utf8') });
await crx.load(distDir);
const buffer = await crx.pack();
writeFileSync(join(outDir, CRX_NAME), buffer);

const crxUrl = `${PAGES_BASE}/${CRX_NAME}`;
const updatesXml = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${EXPECTED_ID}">
    <updatecheck codebase="${crxUrl}" version="${version}" />
  </app>
</gupdate>
`;
writeFileSync(join(outDir, 'updates.xml'), updatesXml);

const indexHtml = `<!doctype html>
<meta charset="utf-8">
<title>Tempo Auto Logger</title>
<h1>Tempo Auto Logger</h1>
<p>Internal Chrome extension. See <a href="https://github.com/${REPO_OWNER}/${REPO_NAME}">repo</a> for install instructions.</p>
<p>Current version: ${version}</p>
`;
writeFileSync(join(outDir, 'index.html'), indexHtml);

console.log(`Built CRX v${version} -> pages/${CRX_NAME}`);
console.log(`Wrote updates.xml pointing to ${crxUrl}`);
