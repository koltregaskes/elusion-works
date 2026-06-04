import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));

console.log('=== Starting Nebula Architect Integration Checks ===');

const files = ['index.html', 'styles.css', 'app.js'];

for (const file of files) {
  const filePath = path.join(SITE_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.error(`FAIL: File ${file} does not exist at ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  console.log(`PASS: ${file} exists and is readable (${content.length} bytes).`);

  // Verify key variables or anchors in content
  if (file === 'index.html') {
    if (content.includes('NEBULA ARCHITECT') && content.includes('slideIon') && content.includes('radarSvg')) {
      console.log('PASS: index.html contains core markup anchors.');
    } else {
      console.error('FAIL: index.html is missing required anchors.');
      process.exit(1);
    }
  }

  if (file === 'styles.css') {
    if (content.includes('--color-bg-dark') && content.includes('.glass-card') && content.includes('.radar-grid')) {
      console.log('PASS: styles.css contains core theme tokens and layouts.');
    } else {
      console.error('FAIL: styles.css is missing required classes or variables.');
      process.exit(1);
    }
  }

  if (file === 'app.js') {
    if (content.includes('updatePhysics') && content.includes('handleRadarMove') && content.includes('loadBeat')) {
      console.log('PASS: app.js contains core interactive simulation state and drag handlers.');
    } else {
      console.error('FAIL: app.js is missing required Javascript methods.');
      process.exit(1);
    }
  }
}

console.log('\nALL INTEGRATION AND CODE SANITY CHECKS PASSED FOR NEBULA ARCHITECT!');
