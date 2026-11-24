/**
 * Starts the Python backend ("sidecar") and keeps it running.
 *
 * - Development: `python -m flick` in the repo's backend/ folder.
 * - Installed app: resources/backend/flick-backend.exe (built with PyInstaller, issue #18).
 *
 * The backend gets a free port and a random token for this launch only, so no other
 * program on the computer can use it. It prints "FLICK_READY <port>" when it is ready.
 */
import { ChildProcess, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { createServer } from 'net';
import * as path from 'path';
import { safeError, safeLog } from './logging';

export interface BackendInfo {
  port: number;
  token: string;
}

export interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
}

const READY_TIMEOUT_MS = 60_000;
const MAX_RESTARTS = 3;

/** "FLICK_READY 8765" → 8765, anything else → null. */
export function parseReady(line: string): number | null {
  const match = /^FLICK_READY (\d+)\s*$/.exec(line.trim());
  return match ? Number(match[1]) : null;
}

/** Python to use in development. FLICK_PYTHON overrides (e.g. a virtualenv's python.exe). */
export function pythonCommand(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  return env.FLICK_PYTHON || (platform === 'win32' ? 'python' : 'python3');
}

export function launchPlan(opts: {
  packaged: boolean;
  resourcesPath: string;
  repoRoot: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  port: number;
}): LaunchPlan {
  if (opts.packaged) {
    const dir = path.join(opts.resourcesPath, 'backend');
    const exe = opts.platform === 'win32' ? 'flick-backend.exe' : 'flick-backend';
    return { command: path.join(dir, exe), args: ['--port', String(opts.port)], cwd: dir };
  }
  return {
    command: pythonCommand(opts.platform, opts.env),
    args: ['-m', 'flick', '--port', String(opts.port)],
    cwd: path.join(opts.repoRoot, 'backend'),
  };
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export class Backend {
  private child: ChildProcess | null = null;
  private stopping = false;
  private restarts = 0;
  private info: BackendInfo | null = null;
  private lastOutput: string[] = [];

  constructor(private readonly plan: (port: number) => LaunchPlan) {}

  /** Starts the backend and resolves when it prints FLICK_READY. */
  async start(): Promise<BackendInfo> {
    const port = await freePort();
    this.info = { port, token: randomBytes(24).toString('hex') };
    await this.spawnAndWait();
    return this.info;
  }

  /** The last lines the backend printed (for the error dialog). */
  recentOutput(): string {
    return this.lastOutput.join('\n');
  }

  stop(): void {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      if (process.platform === 'win32' && child.pid) {
        // Kill the whole process tree (python may start helper processes).
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        child.kill();
      }
    }
  }

  private spawnAndWait(): Promise<void> {
    const info = this.info!;
    const plan = this.plan(info.port);
    safeLog(`[flick] starting backend: ${plan.command} ${plan.args.join(' ')} (in ${plan.cwd})`);

    return new Promise((resolve, reject) => {
      let ready = false;
      const child = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env: { ...process.env, FLICK_TOKEN: info.token, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      });
      this.child = child;

      const timer = setTimeout(() => {
        if (!ready) reject(new Error('The Flick backend did not start in time.'));
      }, READY_TIMEOUT_MS);

      const onOutput = (data: Buffer) => {
        for (const line of data.toString('utf-8').split(/\r?\n/)) {
          if (!line.trim()) continue;
          this.lastOutput = [...this.lastOutput, line].slice(-15);
          if (!ready && parseReady(line) !== null) {
            ready = true;
            clearTimeout(timer);
            safeLog('[flick] backend ready');
            resolve();
          }
        }
      };
      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);

      child.on('error', (err) => {
        clearTimeout(timer);
        if (!ready) reject(err);
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        if (!ready) {
          reject(new Error(`The Flick backend stopped (exit code ${code}).`));
          return;
        }
        if (this.stopping) return;
        // It crashed while running: start it again on the same port and token.
        if (this.restarts < MAX_RESTARTS) {
          this.restarts += 1;
          safeError(`[flick] backend stopped (code ${code}); restarting (${this.restarts}/${MAX_RESTARTS})`);
          this.spawnAndWait().catch((err) => safeError('[flick] restart failed:', err));
        } else {
          safeError('[flick] backend keeps stopping; not restarting again');
        }
      });
    });
  }
}
