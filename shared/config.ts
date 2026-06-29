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
} as const;
