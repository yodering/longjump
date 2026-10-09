import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Changes to physics or command semantics identify a new rules version in saves.
const rules = createHash('sha256');
for (const path of ['src/physics.ts', 'src/commands.ts', 'src/bindings.ts']) rules.update(readFileSync(path));
export default defineConfig({
  define: { 'import.meta.env.VITE_PHYSICS_VERSION': JSON.stringify(rules.digest('hex')) },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
});
