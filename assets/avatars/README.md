# Avatar assets (GLB)

M2/M3 will load rigged characters from this folder. Plan: 6–10 GLB models
(`avatar0.glb` … `avatarN.glb`), indexed by the `avatarId` assigned at
check-in (see `AVATAR_MODEL_COUNT` in `shared/config.ts`).

Recommended source: **Mixamo** (free, auto-rigged, licensable for event use).
Export each character as GLB (or FBX → convert), and share one animation set
(idle / walk / look-around / nod / wave) across models via retargeting so they
all use the same `AnimationClip` names.

Until real models are added, the screen uses a glowing-capsule placeholder
(`apps/screen/scene/persona.ts`).
