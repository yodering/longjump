import type { Server } from 'bun';
import type { Database } from 'bun:sqlite';
import { gate, type ProxyConfig } from './http';
import { createLeaderboard } from './leaderboard';
import { createRooms, SNAPSHOT_MS, type RoomSocket } from './rooms';
import type { MapRules } from './versions';

export type AppConfig = { db: Database; maps: Record<string, MapRules>; physicsVersion: string; adminToken?: string; proxy: ProxyConfig };

/** HTTP routes, the room WebSocket and the snapshot timer for one Bun.serve instance. */
export function createApp(config: AppConfig) {
  const leaderboard = createLeaderboard(config);
  const rooms = createRooms({ db: config.db, physicsVersion: config.physicsVersion, mapIds: Object.keys(config.maps) });
  const timer = setInterval(rooms.snapshot, SNAPSHOT_MS);
  return {
    rooms,
    stop() { clearInterval(timer); },
    fetch(request: Request, server: Server<{ address: string }>) {
      const url = new URL(request.url);
      if (url.pathname === '/healthz') { config.db.query('SELECT 1').get(); return new Response('ok', { headers: { 'Cache-Control': 'no-store' } }); }
      const allowed = gate(request, config.proxy);
      if (!allowed || !url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
      if (url.pathname === '/api/rooms') {
        if (server.upgrade(request, { data: { address: allowed.address } })) return undefined;
        return new Response('Expected a WebSocket.', { status: 426 });
      }
      return leaderboard(request, allowed.address);
    },
    websocket: {
      // Poses and announcements are small; anything larger is not from the game.
      maxPayloadLength: 4 * 1024, idleTimeout: 60, perMessageDeflate: false,
      open: (ws: RoomSocket) => rooms.open(ws),
      message: (ws: RoomSocket, message: string | Buffer) => rooms.message(ws, message),
      close: (ws: RoomSocket) => rooms.close(ws),
    },
  };
}
