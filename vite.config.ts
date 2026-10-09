import { defineConfig } from 'vite';
import { physicsVersion } from './server/versions';

// Changes to physics or command semantics identify a new rules version in saves.
// The leaderboard server computes the same hash and rejects replays from other rules.
export default defineConfig({
  define: { 'import.meta.env.VITE_PHYSICS_VERSION': JSON.stringify(physicsVersion()) },
  server: { proxy: { '/api': { target: process.env.LONGJUMP_API ?? 'http://127.0.0.1:8787', changeOrigin: false, ws: true } } },
});
