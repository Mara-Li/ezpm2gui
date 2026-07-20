const fs = require('fs');
const path = require('path');

// Runs after `tsc`/`tsc --project tsconfig.bin.json` (root "build" script) via
// npm/pnpm's automatic postbuild hook. Handles the two things tsc itself
// doesn't: copying a runtime JSON asset and marking the CLI entry points
// executable.

const rootDir = path.resolve(__dirname, '..');
const binDir = path.join(rootDir, 'bin');
const serverConfigSrc = path.join(rootDir, 'src', 'server', 'config', 'project-configs.json');
const serverConfigDistDir = path.join(rootDir, 'dist', 'server', 'config');
const serverConfigDist = path.join(serverConfigDistDir, 'project-configs.json');

fs.mkdirSync(serverConfigDistDir, { recursive: true });
fs.copyFileSync(serverConfigSrc, serverConfigDist);
console.log('✓ Copied server configuration file');

for (const file of ['ezpm2gui.js', 'generate-ecosystem.js']) {
  const filePath = path.join(binDir, file);
  if (fs.existsSync(filePath)) {
    try {
      fs.chmodSync(filePath, '755');
    } catch {
      // Windows has no execute bit to set
    }
  }
}
console.log('✓ Marked CLI entry points executable');
