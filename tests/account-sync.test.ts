import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { HistoryArchive, type SavedEntry } from '../src/history-archive';
import { AccountSync, AccountError } from '../src/account-sync';
import { backupEntry } from '../src/backup';

const entry = (id: string, distance = 240): SavedEntry => ({ ...backupEntry({ mapId: 'longjump_source_go', tickRate: 128, autoBhop: false,
  distance, valid: true, landed: true, at: 1000, sync: 80, strafes: [], path: [] }), id });
function server(owner: string) {
  const rows = new Map<string, SavedEntry>();
  let failAfterSave = false, wrongAck = false, session = owner, calls = 0;
  const request = async (path: string, data?: unknown, expected?: string) => {
    calls++;
    if (session !== expected) throw new AccountError('Session changed', 409, 'account_changed');
    if (data === undefined) {
      const after = Number(path.split('=')[1]); const all = [...rows.values()];
      return { owner: session, attempts: all.slice(after, after + 50), bests: [], cursor: Math.min(after + 50, all.length), more: all.length > after + 50 };
    }
    const payload = data as { attempts: SavedEntry[] };
    for (const attempt of payload.attempts) rows.set(attempt.id, attempt);
    if (failAfterSave) { failAfterSave = false; throw new Error('Connection lost'); }
    return { owner: session, acknowledged: wrongAck ? ['wrong-id'] : payload.attempts.map(attempt => attempt.id) };
  };
  return { rows, request, loseResponse: () => { failAfterSave = true; }, badAck: () => { wrongAck = true; }, switchSession: () => { session = 'other-account'; }, calls: () => calls };
}

test('Outbox, standalone bests and download cursor survive reload; remote records do not queue uploads', async () => {
  const factory = new IDBFactory(); let archive = new HistoryArchive([], factory, 'account-a', true);
  await archive.merge([entry('local:1')], [entry('best:1', 250)]);
  await archive.merge([entry('remote:1', 245)], [], { cursor: 17 });
  const before = await archive.pending(); assert.equal(before.count, 1); assert.equal(before.bests[0].distance, 250);
  await archive.close(); archive = new HistoryArchive([], factory, 'account-a', true);
  assert.equal(await archive.cursor(), 17); assert.equal((await archive.pending()).count, 1);
  await archive.acknowledge(['local:1'], before.revision!);
  assert.equal((await archive.pending()).count, 0); assert.equal((await archive.pending()).revision, null);
  await archive.close();
});
test('A late PB acknowledgment cannot erase a newer pending best', async () => {
  const archive = new HistoryArchive([], new IDBFactory(), 'account', true);
  await archive.merge([], [entry('best:1', 240)]); const old = await archive.pending();
  await archive.merge([], [entry('best:2', 250)]); await archive.acknowledge([], old.revision!);
  const current = await archive.pending(); assert.ok(current.revision); assert.notEqual(current.revision, old.revision); assert.equal(current.bests[0].distance, 250);
  await archive.close();
});
test('Lost server acknowledgments retry without duplication and preserve all local data', async () => {
  const archive = new HistoryArchive([], new IDBFactory(), 'account', true), remote = server('account');
  await archive.merge([entry('retry:1'), entry('retry:2')], []); remote.loseResponse();
  const states: string[] = [], sync = new AccountSync(archive, 'account', () => true, text => states.push(text), async () => {}, remote.request, 0);
  await sync.sync(); assert.equal((await archive.pending()).count, 2); assert.equal(remote.rows.size, 2);
  await sync.sync(); assert.equal((await archive.pending()).count, 0); assert.equal(remote.rows.size, 2); assert.equal((await archive.export()).length, 2);
  assert.equal(states.at(-1), 'Saved to cloud'); sync.stop(); await archive.close();
});
test('Unexpected acknowledgments and cross-tab account changes retain the outbox', async () => {
  for (const issue of ['ack', 'session']) {
    const archive = new HistoryArchive([], new IDBFactory(), issue, true), remote = server('account');
    await archive.merge([entry('own:1')], []);
    if (issue === 'ack') remote.badAck(); else remote.switchSession();
    const states: string[] = [], sync = new AccountSync(archive, 'account', () => true, text => states.push(text), async () => {}, remote.request, 0);
    await sync.sync(); assert.equal((await archive.pending()).count, 1); assert.notEqual(states.at(-1), 'Saved to cloud');
    if (issue === 'session') assert.equal(remote.rows.size, 0);
    sync.stop(); await archive.close();
  }
});
test('Guest and account archives stay separate, and playing prevents network sync', async () => {
  const factory = new IDBFactory(), guest = new HistoryArchive([], factory, 'guest'), a = new HistoryArchive([], factory, 'a', true), b = new HistoryArchive([], factory, 'b', true);
  await guest.merge([entry('guest:1')], []); assert.equal((await a.export()).length, 0);
  await a.merge(await guest.export(), await guest.bests());
  assert.equal((await guest.export()).length, 1); assert.equal((await b.export()).length, 0);
  const remote = server('a'); let playing = true;
  const sync = new AccountSync(a, 'a', () => !playing, () => {}, async () => {}, remote.request, 0);
  await sync.sync(); assert.equal(remote.calls(), 0); assert.equal((await a.pending()).count, 1);
  playing = false; await sync.sync(); assert.equal(remote.rows.size, 1); sync.stop();
  await Promise.all([guest.close(), a.close(), b.close()]);
});
test('Failed download transactions do not advance the cursor or partly replace history', async () => {
  const archive = new HistoryArchive([], new IDBFactory(), 'account', true);
  await archive.merge([entry('existing:1')], []);
  await assert.rejects(archive.merge([entry('new:1'), entry('existing:1', 300)], [], { cursor: 23 }), /conflicts/);
  assert.equal(await archive.cursor(), 0); assert.equal((await archive.export()).length, 1); assert.equal((await archive.pending()).count, 1);
  await archive.close();
});

test('A second device downloads paginated history and standalone bests without re-uploading it', async () => {
  const source = new HistoryArchive([], new IDBFactory(), 'source', true), remote = server('account');
  await source.merge(Array.from({ length: 125 }, (_, i) => entry(`device:one:${i}`, 240 + i / 100)), []);
  const upload = new AccountSync(source, 'account', () => true, () => {}, async () => {}, remote.request, 0);
  await upload.sync(); upload.stop(); assert.equal(remote.rows.size, 125);
  const destination = new HistoryArchive([], new IDBFactory(), 'destination', true);
  const download = new AccountSync(destination, 'account', () => true, () => {}, async () => {}, remote.request, 0);
  await download.sync(); download.stop();
  assert.equal((await destination.export()).length, 125); assert.equal((await destination.pending()).count, 0);
  assert.equal((await destination.bests())[0].distance, 241.24); assert.equal(await destination.cursor(), 125);
  await Promise.all([source.close(), destination.close()]);
});
test('Pausing during an in-flight upload leaves the attempt queued even if the server saved it', async () => {
  const archive = new HistoryArchive([], new IDBFactory(), 'account', true), remote = server('account');
  await archive.merge([entry('pause:1')], []);
  let saved!: () => void, release!: () => void;
  const savedSignal = new Promise<void>(resolve => { saved = resolve; });
  const releaseSignal = new Promise<void>(resolve => { release = resolve; });
  const request = async (...args: Parameters<typeof remote.request>) => {
    const result = await remote.request(...args);
    if (args[1] !== undefined) { saved(); await releaseSignal; }
    return result;
  };
  const sync = new AccountSync(archive, 'account', () => true, () => {}, async () => {}, request, 0);
  const operation = sync.sync(); await savedSignal; sync.pause(); release(); await operation;
  assert.equal((await archive.pending()).count, 1); assert.equal(remote.rows.size, 1);
  await sync.sync(); assert.equal((await archive.pending()).count, 0); assert.equal(remote.rows.size, 1);
  sync.stop(); await archive.close();
});
