import { spawnSync } from 'child_process';
import os from 'os';

const requestedPort = process.env.PORT || '5000';
const ports = [...new Set([requestedPort, '5000', '5001'].filter(Boolean))];
const platform = os.platform();

function killPort(portNumber) {
  if (platform === 'win32') {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${portNumber} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
      ],
      { stdio: 'inherit' }
    );
    if (result.status !== 0) {
      console.warn(`[kill-port] PowerShell cleanup completed with exit code ${result.status}`);
    }
    return;
  }

  const result = spawnSync('sh', ['-c', `lsof -ti tcp:${portNumber} | xargs -r kill -9 || true`], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.warn(`[kill-port] Unix cleanup completed with exit code ${result.status}`);
  }
}

ports.forEach((port) => killPort(port));
console.log(`[kill-port] Cleared any process using ports: ${ports.join(', ')}`);
