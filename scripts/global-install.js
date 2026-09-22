#!/usr/bin/env node

/**
 * Builds, packs, and installs verdaccio globally from the local workspace.
 *
 * Workspace dependencies (@verdaccio/middleware, @verdaccio/ui-theme, etc.)
 * are packed separately and overlaid on top of the global install so that
 * local changes are reflected.
 *
 * Usage:
 *   pnpm global:install
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function runCapture(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', ...opts }).trim();
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdaccio-global-'));
console.log(`Temp directory: ${tmpDir}`);

// Auto-discover all workspace packages by scanning for package.json files
function discoverWorkspacePackages() {
  const packages = [];
  const packagesDir = path.join(ROOT, 'packages');

  function scan(dir, depth = 0) {
    if (depth > 4) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === 'build') continue;
      const fullPath = path.join(dir, entry.name);
      const pkgJson = path.join(fullPath, 'package.json');
      if (fs.existsSync(pkgJson)) {
        try {
          const { name } = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
          if (name && name !== 'verdaccio') {
            packages.push({ dir: path.relative(ROOT, fullPath), scope: name });
          }
        } catch {
          /* skip unparseable package.json */
        }
      }
      scan(fullPath, depth + 1);
    }
  }

  scan(packagesDir);
  return packages;
}

const OVERLAY_PACKAGES = discoverWorkspacePackages();

// Workspace deps resolve from local tarballs: unpublished packages are missing
// on the registry and published builds can skew against local code.
const manifests = new Map([
  [
    'verdaccio',
    JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/verdaccio/package.json'), 'utf-8')),
  ],
]);
for (const pkg of OVERLAY_PACKAGES) {
  const manifestPath = path.join(ROOT, pkg.dir, 'package.json');
  if (fs.existsSync(manifestPath)) {
    manifests.set(pkg.scope, JSON.parse(fs.readFileSync(manifestPath, 'utf-8')));
  }
}
const workspaceDepsOf = (name) => {
  const manifest = manifests.get(name) || {};
  return ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) =>
    Object.entries(manifest[field] || {})
      .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('workspace:'))
      .map(([dep]) => dep)
  );
};
const depClosure = new Set();
const queue = workspaceDepsOf('verdaccio');
while (queue.length) {
  const name = queue.pop();
  if (!depClosure.has(name)) {
    depClosure.add(name);
    queue.push(...workspaceDepsOf(name));
  }
}

// 1. Pack verdaccio itself
console.log('\nPacking verdaccio...');
run(`pnpm pack --pack-destination "${tmpDir}"`, { cwd: path.join(ROOT, 'packages/verdaccio') });

// 2. Pack all workspace packages once. The tarballs satisfy the global
// install for unpublished workspace deps and feed the overlay pass below.
const packedWorkspace = new Map();
for (const pkg of OVERLAY_PACKAGES) {
  const pkgDir = path.join(ROOT, pkg.dir);
  if (!fs.existsSync(pkgDir)) {
    console.warn(`Skipping ${pkg.scope}: directory not found`);
    continue;
  }

  // Isolated subdirectory avoids tarball name collisions; fixture dirs that
  // cannot pack are skipped rather than aborting the install.
  const packDir = path.join(tmpDir, pkg.dir.replace(/\//g, '-'));
  fs.mkdirSync(packDir, { recursive: true });
  try {
    run(`pnpm pack --pack-destination "${packDir}"`, { cwd: pkgDir });
  } catch {
    console.warn(`Skipping ${pkg.scope}: pnpm pack failed`);
    continue;
  }

  const pkgTarball = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  if (!pkgTarball) {
    console.warn(`No tarball found for ${pkg.scope}`);
    continue;
  }
  packedWorkspace.set(pkg.scope, path.join(packDir, pkgTarball));
}

// 3. Install globally from tarball
const tarballs = fs
  .readdirSync(tmpDir)
  .filter((f) => f.startsWith('verdaccio-') && f.endsWith('.tgz'));
if (tarballs.length === 0) {
  console.error('No tarball found');
  process.exit(1);
}
const mainTarball = path.join(tmpDir, tarballs[0]);
const localDepTarballs = [...depClosure]
  .map((name) => packedWorkspace.get(name))
  .filter(Boolean)
  .map((t) => `"${t}"`)
  .join(' ');
console.log(`\nInstalling globally: ${mainTarball}`);
run(`npm install -g "${mainTarball}" ${localDepTarballs}`);

// 4. Find the global install location
const globalRoot = runCapture('npm root -g');
const globalVerdaccio = path.join(globalRoot, 'verdaccio', 'node_modules');

// 5. Overlay workspace dependencies
for (const pkg of OVERLAY_PACKAGES) {
  const tarball = packedWorkspace.get(pkg.scope);
  if (!tarball) {
    continue;
  }

  const targetDir = path.join(globalVerdaccio, ...pkg.scope.split('/'));
  if (!fs.existsSync(targetDir)) {
    console.log(`Skipping ${pkg.scope}: not in global install`);
    continue;
  }

  console.log(`\nOverlaying ${pkg.scope}...`);
  run(`tar xzf "${tarball}" --strip-components=1 -C "${targetDir}"`);
}

// 6. Verify
const version = runCapture('verdaccio --version');
console.log(`\nInstalled verdaccio ${version}`);
console.log('Run: verdaccio');

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });
