export interface Rider {
  id: string;
  name: string;
  avatarEmoji: string;
  vehicleEmoji: string;
  rating: number;
  deliveryCount: string;
}

export const RIDERS: Rider[] = [
  { id: 'zhaolei', name: '赵雷', avatarEmoji: '🧑‍🦱', vehicleEmoji: '🛵', rating: 4.9, deliveryCount: '12万+' },
  { id: 'wangfang', name: '王芳', avatarEmoji: '👩‍🦰', vehicleEmoji: '🚲', rating: 4.8, deliveryCount: '9万+' },
  { id: 'liuqiang', name: '刘强', avatarEmoji: '👨‍🦳', vehicleEmoji: '🛴', rating: 4.7, deliveryCount: '6万+' },
  { id: 'chenjing', name: '陈静', avatarEmoji: '👩‍🦱', vehicleEmoji: '🛵', rating: 5.0, deliveryCount: '15万+' },
  { id: 'sunhao', name: '孙浩', avatarEmoji: '🧑‍🦲', vehicleEmoji: '🚲', rating: 4.6, deliveryCount: '4万+' },
  { id: 'zhouyan', name: '周燕', avatarEmoji: '👩‍🦳', vehicleEmoji: '🛵', rating: 4.9, deliveryCount: '11万+' },
];

export function getRandomRider(): Rider {
  return RIDERS[Math.floor(Math.random() * RIDERS.length)];
}
