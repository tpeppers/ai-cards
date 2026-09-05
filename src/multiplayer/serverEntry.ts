/**
 * Entry point for the Node-side engine bundle.
 *
 * `npm run build:engine` runs esbuild over this file to produce
 * server/engine/bundle.cjs, which lets the multiplayer server run the exact
 * same Bid Whist engine, strategies and record format the browser uses —
 * no second implementation to keep in sync.
 *
 * Nothing here may touch the DOM. Two dependencies reference browser globals
 * and are safe only because the engine never reaches them:
 *   - utils/gameSettings.ts guards localStorage in try/catch with a default.
 *   - urlGameState.js touches window only inside its URL-hash helpers.
 */

export { HostGame } from './hostGame.ts';
export type { LifecycleEvent } from './hostGame.ts';
export { BidWhistGame } from '../games/BidWhistGame.ts';
export { STRATEGY_REGISTRY } from '../strategies/index.ts';
export { encodeHandRecord, decodeHandRecord } from '../utils/gameRecord.ts';
export type { HandRecord } from '../utils/gameRecord.ts';
export { buildHandRecord } from '../utils/challengeRecorder.ts';
export { cardToLetter, letterToCard } from '../urlGameState.js';
export type {
  LobbyPlayer,
  MultiplayerGameState,
  PlayerAction,
} from './types.ts';
