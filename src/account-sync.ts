import { backupEntry } from './backup';
import { HistoryArchive, type SavedEntry } from './history-archive';

export type AccountUser = { id: string; username: string; displayName: string };
export class AccountError extends Error {
  constructor(message: string, readonly status = 0, readonly code = '') { super(message); }
}
export async function accountRequest(path: string, data?: unknown, owner?: string, signal?: AbortSignal) {
  const response = await fetch(`/api/${path}`, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(owner ? { 'X-Longjump-Account': owner } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new AccountError('Accounts are not available on this server yet.', 503);
  const result = await response.json();
  if (!response.ok) throw new AccountError(result.error ?? 'Account request failed. Try again.', response.status, result.code);
  return result;
}
export function accountUser(value: unknown): AccountUser {
  const user = value as AccountUser;
  if (!user || typeof user.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(user.id)
    || typeof user.username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(user.username)
    || typeof user.displayName !== 'string' || user.displayName.length > 20) throw new Error('Invalid account response.');
  return { id: user.id, username: user.username, displayName: user.displayName };
}
export class AccountSync {
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private stopped = false;
  private blocked = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly archive: HistoryArchive, readonly owner: string, private canRun: () => boolean,
    private status: (message: string) => void, private merged: () => Promise<void>,
    private request = accountRequest, private spacing = 1100) {}
  stop() { this.stopped = true; this.pause(); }
  pause() { clearTimeout(this.timer); this.controller?.abort(); }
  wake() {
    if (this.stopped || this.blocked || !this.canRun()) return;
    clearTimeout(this.timer);
    if (!this.running) this.status('Waiting to sync…');
    this.timer = setTimeout(() => void this.sync(), 200);
  }
  sync() {
    if (this.running) return this.running;
    if (this.stopped || this.blocked || !this.canRun()) return Promise.resolve();
    const controller = this.controller = new AbortController();
    const check = () => { if (this.stopped || controller.signal.aborted || !this.canRun()) throw new DOMException('Paused', 'AbortError'); };
    const wait = async () => {
      if (this.spacing) await new Promise<void>(resolve => setTimeout(resolve, this.spacing));
      check();
    };
    this.running = (async () => {
      try {
        check(); this.status('Syncing…');
        let cursor = await this.archive.cursor();
        while (true) {
          check();
          const result = await this.request(`sync?after=${cursor}`, undefined, this.owner, controller.signal);
          check();
          if (result.owner !== this.owner || !Array.isArray(result.attempts) || result.attempts.length > 50
            || !Array.isArray(result.bests) || result.bests.length > 24 || typeof result.more !== 'boolean'
            || !Number.isSafeInteger(result.cursor) || result.cursor < cursor || (result.more && result.cursor <= cursor))
            throw new Error('Invalid cloud-save response. Local progress is safe.');
          const attempts = result.attempts.map((value: unknown) => {
            const id = (value as SavedEntry)?.id;
            if (typeof id !== 'string' || !/^[a-zA-Z0-9:-]{1,256}$/.test(id)) throw new Error('Invalid cloud attempt.');
            return { ...backupEntry(value), id };
          });
          await this.archive.merge(attempts, result.bests.map(backupEntry), { cursor: result.cursor });
          check(); await this.merged(); cursor = result.cursor;
          if (!result.more) break;
          await wait();
        }
        while (true) {
          check(); const pending = await this.archive.pending();
          if (!pending.count && !pending.revision) break;
          const batch: SavedEntry[] = [];
          for (const entry of pending.attempts) {
            const candidate = [...batch, entry];
            if (new TextEncoder().encode(JSON.stringify({ attempts: candidate })).length > 240 * 1024) break;
            batch.push(entry);
          }
          if (pending.count && !batch.length) throw new Error('A jump is too large to sync. Export a backup to keep it.');
          const send = async (attempts: SavedEntry[], bests: unknown[]) => {
            check();
            const result = await this.request('sync', { attempts, bests }, this.owner, controller.signal);
            check();
            const ids = attempts.map(entry => entry.id);
            if (result.owner !== this.owner || !Array.isArray(result.acknowledged)
              || result.acknowledged.length !== ids.length || new Set(result.acknowledged).size !== ids.length
              || result.acknowledged.some((id: string) => !ids.includes(id)))
              throw new Error('Cloud save was not confirmed. Local progress is safe.');
            await this.archive.acknowledge(ids);
          };
          if (batch.length) { await send(batch, []); await wait(); }
          if (pending.revision) {
            for (const best of pending.bests) { await send([], [best]); await wait(); }
            check(); await this.archive.acknowledge([], pending.revision);
          }
        }
        check(); this.status('Saved to cloud');
      } catch (error) {
        if (controller.signal.aborted || this.stopped) return;
        if (error instanceof AccountError && (error.status === 401 || error.status === 413 || error.status === 409)) this.blocked = true;
        this.status(error instanceof AccountError && (error.status === 401 || error.code === 'account_changed')
          ? 'Sign in again to sync. Jumps stay saved here.'
          : error instanceof Error ? `${error.message} Progress stays on this device.` : 'Offline · progress saved here');
      } finally {
        this.running = null;
        if (!this.stopped && !this.blocked && this.canRun()) this.timer = setTimeout(() => void this.sync(), 30_000);
      }
    })();
    return this.running;
  }
}
