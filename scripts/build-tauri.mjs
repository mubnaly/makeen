import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execSync } from 'node:child_process';

// 1. Build web assets first
console.log('==> [1/3] Building frontend assets with Vite...');
execSync('npm run build', { stdio: 'inherit' });

// 2. Locate cargo binary
let cargoCmd = 'cargo';
const cargoHome = path.join(os.homedir(), '.cargo', 'bin');
const cargoBin = path.join(cargoHome, process.platform === 'win32' ? 'cargo.exe' : 'cargo');

try {
  const check = spawnSync('cargo', ['--version'], { stdio: 'pipe' });
  if (check.status !== 0 && fs.existsSync(cargoBin)) {
    cargoCmd = cargoBin;
  }
} catch {
  if (fs.existsSync(cargoBin)) {
    cargoCmd = cargoBin;
  }
}

// Ensure cargo bin is in env PATH for subcommands
const env = { ...process.env };
if (fs.existsSync(cargoHome)) {
  const delimiter = path.delimiter;
  env.PATH = `${cargoHome}${delimiter}${env.PATH || ''}`;
}

console.log(`==> [2/3] Compiling Tauri release binary using: ${cargoCmd}...`);
const cargoRes = spawnSync(cargoCmd, ['build', '--release', '--manifest-path', 'src-tauri/Cargo.toml'], {
  stdio: 'inherit',
  env
});

if (cargoRes.status !== 0) {
  console.error('Cargo build failed with exit code:', cargoRes.status);
  process.exit(cargoRes.status || 1);
}

// 3. Copy executable to release/
const isWin = process.platform === 'win32';
const srcExe = path.resolve('src-tauri/target/release', isWin ? 'makeen.exe' : 'makeen');
const releaseDir = path.resolve('release');
const targetExe = path.resolve(releaseDir, isWin ? 'Makeen-Tauri-x64.exe' : 'Makeen-Tauri-x64');

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

if (fs.existsSync(srcExe)) {
  fs.copyFileSync(srcExe, targetExe);
  const stats = fs.statSync(targetExe);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`==> [3/3] Successfully built and copied Tauri release to: ${targetExe} (${sizeMb} MB)`);
} else {
  console.error('Expected compiled binary not found at:', srcExe);
  process.exit(1);
}
