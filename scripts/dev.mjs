import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const isWin = process.platform === 'win32';

function launch(name, npmArgs, colorCode) {
  const cmd = isWin ? 'cmd.exe' : 'npm';
  const args = isWin ? ['/d', '/s', '/c', 'npm', ...npmArgs] : npmArgs;

  const child = spawn(cmd, args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const prefix = `\x1b[${colorCode}m[${name}]\x1b[0m`;

  child.stdout?.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) console.log(`${prefix} ${line}`);
    }
  });

  child.stderr?.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) console.error(`${prefix} ${line}`);
    }
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`${prefix} exited with code ${code}`);
    }
  });

  return child;
}

console.log('Starting MuseHQ Server & Virtual Office Client...');
const server = launch('SERVER', ['--prefix', 'server', 'run', 'dev'], '36');
const client = launch('CLIENT', ['--prefix', 'client', 'run', 'dev'], '35');

let shuttingDown = false;

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed || !child.pid) return;
  if (isWin) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  killTree(server);
  killTree(client);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
