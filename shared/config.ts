// Runtime configuration shared across server + apps.
// Avatar set: number of distinct GLB character models available for random
// assignment. Keep in sync with assets/avatars/ once real models are added.
export const AVATAR_MODEL_COUNT = 8;

export const DEFAULTS = {
  port: 8080,
  maxAvatars: 50,
  spawnIntervalSec: 2.5,
  lite: false,
  recentLimit: 10,
  sponsorIntervalSec: 6,
  slogan: "携手创新 · 共塑未来",
  guestFeedHidden: false,
} as const;

// Lucky-draw presentation timing (spec: total roll 8–15s, configurable).
export const DRAW_DEFAULTS = {
  reelSize: 60, // guest names streamed to the reel per roll
  rollMs: 6000, // fast constant scroll before the winner reveal lands
  decelMs: 2200, // eased deceleration onto the winner
  countdownSec: 3, // "3·2·1" before the reveal
  confettiMs: 6000, // confetti burst duration on reveal
} as const;
