import { existsSync } from 'node:fs';

const path = new URL('../worker/.dev.vars', import.meta.url);
if (!existsSync(path)) {
  await Bun.write(path, `AUTH_SECRET=${crypto.randomUUID()}${crypto.randomUUID()}\nAUTH_ORIGIN=http://127.0.0.1:5178\n`);
  console.log('Created a private local account-service secret.');
} else console.log('Keeping the existing local account-service configuration.');
