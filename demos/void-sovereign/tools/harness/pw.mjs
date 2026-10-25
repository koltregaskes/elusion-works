/* Finds Playwright: a local install first, then the global one (`npm root -g`). */
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
let mod;
try { mod = await import('playwright'); } catch (e) {
  const root = execSync('npm root -g').toString().trim();
  mod = await import(pathToFileURL(`${root}/playwright/index.mjs`).href);
}
export const chromium = mod.chromium || (mod.default && mod.default.chromium);
