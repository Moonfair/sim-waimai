import type { Rider } from '@sim-waimai/shared';

/** Mirror of src/data/riders.ts — rider assignment now happens server-side
 *  when an order moves to delivering, and is frozen into rider_snapshot. */
export const RIDERS: Rider[] = [
  { id: 'zhaolei', name: '赵雷', avatarEmoji: '🧑‍🦱', vehicleEmoji: '🛵', rating: 4.9, deliveryCount: '12万+' },
  { id: 'wangfang', name: '王芳', avatarEmoji: '👩‍🦰', vehicleEmoji: '🚲', rating: 4.8, deliveryCount: '9万+' },
  { id: 'liuqiang', name: '刘强', avatarEmoji: '👨‍🦳', vehicleEmoji: '🛴', rating: 4.7, deliveryCount: '6万+' },
  { id: 'chenjing', name: '陈静', avatarEmoji: '👩‍🦱', vehicleEmoji: '🛵', rating: 5.0, deliveryCount: '15万+' },
  { id: 'sunhao', name: '孙浩', avatarEmoji: '🧑‍🦲', vehicleEmoji: '🚲', rating: 4.6, deliveryCount: '4万+' },
  { id: 'zhouyan', name: '周燕', avatarEmoji: '👩‍🦳', vehicleEmoji: '🛵', rating: 4.9, deliveryCount: '11万+' },
];

export function getRandomRider(): Rider {
  return RIDERS[Math.floor(Math.random() * RIDERS.length)]!;
}

const REAL_PERSON_AVATARS = ['🧑', '👩', '🧑‍🦱', '👨‍🦱', '🧑‍🦲', '👩‍🦳'];
const REAL_PERSON_VEHICLES = ['🛵', '🚲', '🛴'];

function hashToIndex(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** Synthesizes a Rider-shaped snapshot from the grabbing user's own identity —
 *  no separate rider/courier role exists; any logged-in user can be "the rider". */
export function buildRealPersonRider(user: { sub: string; username: string }): Rider {
  return {
    id: user.sub,
    name: user.username,
    avatarEmoji: REAL_PERSON_AVATARS[hashToIndex(user.sub, REAL_PERSON_AVATARS.length)]!,
    vehicleEmoji: REAL_PERSON_VEHICLES[hashToIndex(`${user.sub}:v`, REAL_PERSON_VEHICLES.length)]!,
    rating: 5.0,
    deliveryCount: '真人骑手',
  };
}
