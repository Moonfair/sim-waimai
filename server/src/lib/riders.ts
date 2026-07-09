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
