// Moderation commands for the public leaderboard. Needs ADMIN_TOKEN from Railway.
//   bun run leaderboard:admin list [name]
//   bun run leaderboard:admin delete <entry id>
//   bun run leaderboard:admin ban|unban <player id>
//   bun run leaderboard:admin rename <player id> <new name>
const api = process.env.LONGJUMP_API ?? 'https://longjump.ing', token = process.env.ADMIN_TOKEN;
if (!token) { console.error('Set ADMIN_TOKEN to the value configured on Railway.'); process.exit(1); }
const [command, target, value] = process.argv.slice(2);
async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${api}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  if (!response.ok) { console.error(`${response.status}: ${text}`); process.exit(1); }
  return JSON.parse(text);
}
if (command === 'list') {
  const { entries } = await call('GET', `/api/admin/entries?name=${encodeURIComponent(target ?? '')}`);
  console.table(entries.map((e: Record<string, unknown>) => ({ ...e, at: new Date(e.at as number).toISOString().slice(0, 16), banned: !!e.banned })));
} else if (command === 'delete' && target) console.log(await call('DELETE', `/api/admin/entries/${target}`));
else if ((command === 'ban' || command === 'unban') && target) console.log(await call('POST', `/api/admin/players/${target}`, { banned: command === 'ban' }));
else if (command === 'rename' && target && value) console.log(await call('POST', `/api/admin/players/${target}`, { name: value }));
else { console.error('Usage: list [name] | delete <entry id> | ban <player id> | unban <player id> | rename <player id> <name>'); process.exit(1); }
