/**
 * Why are objects rendering as pure black voids?
 *
 * Walks the live scene graph and reports every material, flagging the combinations that
 * render black: metalness high with no environment map (metals have no diffuse lobe, so with
 * nothing to reflect they are black), near-black base colour, and failed/absent maps. Also
 * reports whether the PMREM environment probe actually built.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });

await page.goto('http://127.0.0.1:8123/demos/ashfall/?capture=depot&quality=low', { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => !!window.__ashfall, null, { timeout: 90000 });
await page.waitForFunction(() => {
  const s = document.getElementById('loading');
  return !s || s.hidden || s.classList.contains('is-done');
}, null, { timeout: 300000 });

const report = await page.evaluate(() => {
  const g = window.__ashfall;
  const scene = g.scene;
  const out = {
    hasEnvironment: !!scene.environment,
    environmentIntensity: scene.environmentIntensity,
    lights: [],
    suspicious: [],
    materialCount: 0,
    byType: {},
  };
  scene.traverse((o) => {
    if (o.isLight) {
      out.lights.push({ type: o.type, intensity: o.intensity, colour: o.color && o.color.getHexString() });
    }
  });
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      out.materialCount++;
      out.byType[m.type] = (out.byType[m.type] || 0) + 1;
      const col = m.color ? m.color.getHexString() : null;
      const lum = m.color ? m.color.r * 0.2126 + m.color.g * 0.7152 + m.color.b * 0.0722 : 1;
      const metal = m.metalness ?? 0;
      const reasons = [];
      // A metal with nothing to reflect is black by definition of the BRDF.
      if (metal > 0.5 && !m.envMap && !scene.environment) reasons.push(`metalness ${metal.toFixed(2)} with no envMap and no scene.environment`);
      if (lum < 0.02 && m.type !== 'MeshBasicMaterial') reasons.push(`base colour ${col} is essentially black (lum ${lum.toFixed(4)})`);
      if (metal > 0.9 && (m.roughness ?? 1) < 0.25 && !m.envMap && !scene.environment) reasons.push('mirror metal with no reflection source');
      if (m.map === null && m.color && lum < 0.05) reasons.push('no base map and near-black tint');
      if (reasons.length) {
        out.suspicious.push({
          name: o.name || '(unnamed)',
          matName: m.name || '(unnamed material)',
          type: m.type,
          colour: col,
          metalness: metal,
          roughness: m.roughness,
          hasMap: !!m.map,
          hasEnvMap: !!m.envMap,
          envMapIntensity: m.envMapIntensity,
          emissive: m.emissive ? m.emissive.getHexString() : null,
          reasons,
        });
      }
    }
  });
  return out;
});

console.log('scene.environment present:', report.hasEnvironment, '| intensity', report.environmentIntensity);
console.log('lights:', JSON.stringify(report.lights));
console.log('materials:', report.materialCount, JSON.stringify(report.byType));
console.log(`\nsuspicious materials: ${report.suspicious.length}`);
for (const s of report.suspicious.slice(0, 40)) {
  console.log(`  ${s.name} / ${s.matName} [${s.type}] colour=#${s.colour} metal=${s.metalness} rough=${s.roughness} map=${s.hasMap} env=${s.hasEnvMap}`);
  for (const r of s.reasons) console.log(`      - ${r}`);
}
if (errors.length) {
  console.log('\nerrors:');
  for (const e of errors.slice(0, 20)) console.log('  ' + e);
}
await browser.close();
