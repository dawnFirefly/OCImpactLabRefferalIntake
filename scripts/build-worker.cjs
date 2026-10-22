const { execSync } = require('node:child_process');
const { resolve } = require('node:path');

// Wrangler inherits the caller's directory, even when it discovers a config
// in a parent directory. Anchor npm to the app beside this script instead.
const frontendDirectory = resolve(__dirname, '../frontend');

try {
  execSync('npm ci --include=dev && npm run build:worker', {
    cwd: frontendDirectory,
    stdio: 'inherit',
  });
} catch (error) {
  process.exit(error.status || 1);
}
