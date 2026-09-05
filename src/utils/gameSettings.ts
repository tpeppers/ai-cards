/**
 * Player-facing gameplay preferences.
 *
 * Persisted in localStorage (same store the card backing / suit colour
 * settings use) so they survive reloads and are available to the GitHub
 * Pages standalone build, which has no server to talk to.
 */

const HAND_SORT_KEY = 'directionalHandSort';

/**
 * Whether the hand is reorganized to match the direction that was called.
 *
 * On (the default) each suit reads strongest-first for the contract in play:
 * uptown A K Q J 10 … 2, downtown A 2 3 … K, downtown-no-aces 2 3 … K A.
 * Off, every hand reads uptown regardless of the contract.
 */
export function getDirectionalHandSort(): boolean {
  try {
    return localStorage.getItem(HAND_SORT_KEY) !== 'off';
  } catch {
    // Private-mode / SSR: fall back to the default rather than throwing.
    return true;
  }
}

export function setDirectionalHandSort(enabled: boolean): void {
  try {
    localStorage.setItem(HAND_SORT_KEY, enabled ? 'on' : 'off');
  } catch {}
}
