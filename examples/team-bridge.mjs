/**
 * Launch all 4 Muse peer bots (muse-bagas, muse-arif, muse-niro, muse-joni) into MuseHQ
 * over External WebSocket Bridge in a single process.
 *
 * Usage:
 *   npm run bridge:team
 *   npm run bridge:team -- --bots=bagas,arif --url=wss://musehq.onrender.com/ws/bot
 */

import { createEnvReader } from './lib/env-loader.mjs';
import { resolveBridgeToken } from './lib/resolve-token.mjs';
import { resolveTeamPresets } from './lib/peer-presets.mjs';
import { describeBrainMode } from './lib/brain-adapter.mjs';
import { createPeerBridgeClient, parseCliArgs } from './muse-peer-bridge.mjs';

const args = parseCliArgs();
const extraFiles = args.env ? [args.env] : [];
const env = createEnvReader(extraFiles);
const wsUrl = args.url || env.get('MUSE_WS_URL', 'wss://musehq.onrender.com/ws/bot');
const peers = resolveTeamPresets(args.bots || env.get('MUSE_TEAM_BOTS'), env);

console.log(
  `[TeamBridge] Menghubungkan ${peers.length} bot (${peers
    .map((p) => `${p.id}[${describeBrainMode(p, env)}]`)
    .join(', ')}) ke ${wsUrl}...`
);

const clients = peers.map((peer) =>
  createPeerBridgeClient({
    peer,
    wsUrl,
    token: resolveBridgeToken(wsUrl, extraFiles, peer.id),
    env,
  })
);

clients.forEach((client, index) => {
  if (index === 0) {
    client.start();
  } else {
    setTimeout(() => client.start(), index * 250);
  }
});

function shutdown() {
  console.log('\n[TeamBridge] Memutus seluruh koneksi bot secara bersih...');
  for (const client of clients) {
    client.stop();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
