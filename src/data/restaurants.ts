export type Category = '全部' | '中式快餐' | '汉堡炸鸡' | '日料韩料' | '奶茶饮品' | '小吃零食';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  calories: number;
  emoji: string;
  menuCategory: string;
  popular?: boolean;
}

export interface Restaurant {
  id: string;
  name: string;
  category: Category;
  rating: number;
  ratingCount: number;
  monthlyOrders: number;
  deliveryFee: number;
  deliveryTime: number;
  minOrder: number;
  emoji: string;
  bgColor: string;
  tags: string[];
  menuCategories: string[];
  menu: MenuItem[];
}

export const restaurants: Restaurant[] = [
  {
    id: 'laoxiangji',
    name: '老乡鸡',
    category: '中式快餐',
    rating: 4.8,
    ratingCount: 3200,
    monthlyOrders: 9800,
    deliveryFee: 3,
    deliveryTime: 28,
    minOrder: 15,
    emoji: '🍗',
    bgColor: '#ff8c00',
    tags: ['减配送费', '满20减3', '新客特惠'],
    menuCategories: ['热销', '套餐', '饭类', '汤类'],
    menu: [
      { id: 'hfj', name: '黄焖鸡米饭', description: '招牌黄焖鸡，鸡肉嫩滑入味，搭配米饭', price: 18, calories: 680, emoji: '🍱', menuCategory: '热销', popular: true },
      { id: 'tdj', name: '土豆烩鸡腿饭', description: '软糯土豆配香嫩鸡腿，家常味道', price: 20, calories: 720, emoji: '🍱', menuCategory: '热销', popular: true },
      { id: 'jrj', name: '鸡肉炒饭', description: '蛋炒饭配嫩滑鸡肉粒，香气四溢', price: 16, calories: 590, emoji: '🍳', menuCategory: '饭类' },
      { id: 'tc1', name: '双人套餐A', description: '黄焖鸡米饭×2 + 紫菜蛋花汤×2', price: 34, calories: 1360, emoji: '🎁', menuCategory: '套餐' },
      { id: 'tc2', name: '单人套餐', description: '土豆烩鸡腿饭 + 紫菜蛋花汤', price: 24, calories: 820, emoji: '🎁', menuCategory: '套餐' },
      { id: 'tang1', name: '紫菜蛋花汤', description: '清淡鲜美，暖胃暖心', price: 4, calories: 60, emoji: '🥣', menuCategory: '汤类' },
      { id: 'tang2', name: '番茄蛋花汤', description: '酸甜开胃，番茄香浓', price: 5, calories: 80, emoji: '🥣', menuCategory: '汤类' },
    ],
  },
  {
    id: 'kfc',
    name: '肯德基',
    category: '汉堡炸鸡',
    rating: 4.6,
    ratingCount: 8800,
    monthlyOrders: 25000,
    deliveryFee: 5,
    deliveryTime: 35,
    minOrder: 20,
    emoji: '🍔',
    bgColor: '#e4002b',
    tags: ['品牌店', '满39减5', '第二件半价'],
    menuCategories: ['热销', '汉堡', '炸鸡', '小食', '饮品'],
    menu: [
      { id: 'xlb', name: '香辣鸡腿堡', description: '外酥里嫩的炸鸡腿，搭配香辣酱料', price: 25, calories: 480, emoji: '🍔', menuCategory: '热销', popular: true },
      { id: 'ywj', name: '原味鸡（2块）', description: '经典配方，外皮酥脆，鸡肉鲜嫩', price: 28, calories: 520, emoji: '🍗', menuCategory: '热销', popular: true },
      { id: 'xts', name: '薯条（大）', description: '外酥内软，金黄薯条，经典搭配', price: 16, calories: 450, emoji: '🍟', menuCategory: '小食' },
      { id: 'jxb', name: '劲辣鸡腿堡', description: '更辣更过瘾，满足重口味的你', price: 27, calories: 490, emoji: '🍔', menuCategory: '汉堡' },
      { id: 'popcorn', name: '爆米花鸡（大）', description: '一口一个，酥脆多汁', price: 18, calories: 380, emoji: '🍿', menuCategory: '炸鸡' },
      { id: 'cola', name: '可口可乐（中）', description: '冰爽可口，经典配餐', price: 8, calories: 150, emoji: '🥤', menuCategory: '饮品' },
      { id: 'tc_kfc', name: '双人全家桶套餐', description: '原味鸡×4 + 薯条×2 + 可乐×2', price: 85, calories: 2200, emoji: '🎁', menuCategory: '热销' },
    ],
  },
  {
    id: 'lanzhou',
    name: '兰州拉面馆',
    category: '中式快餐',
    rating: 4.7,
    ratingCount: 1560,
    monthlyOrders: 4300,
    deliveryFee: 3,
    deliveryTime: 25,
    minOrder: 12,
    emoji: '🍜',
    bgColor: '#8B4513',
    tags: ['减配送费', '特色小吃'],
    menuCategories: ['热销', '面食', '小吃'],
    menu: [
      { id: 'nrm', name: '牛肉拉面', description: '正宗兰州拉面，汤清肉嫩，手工拉制', price: 18, calories: 550, emoji: '🍜', menuCategory: '热销', popular: true },
      { id: 'jrm', name: '鸡肉拉面', description: '鲜嫩鸡肉，清香拉面汤底', price: 16, calories: 480, emoji: '🍜', menuCategory: '面食' },
      { id: 'rjm', name: '肉夹馍', description: '外酥内软的馍夹香嫩腊汁肉', price: 12, calories: 420, emoji: '🥙', menuCategory: '热销', popular: true },
      { id: 'sjm', name: '双椒肉夹馍', description: '青椒红椒爆香，肉夹馍升级版', price: 14, calories: 460, emoji: '🌶️', menuCategory: '小吃' },
      { id: 'hpi', name: '凉皮', description: '劲道爽滑，酸辣开胃', price: 10, calories: 280, emoji: '🥗', menuCategory: '小吃' },
    ],
  },
  {
    id: 'heytea',
    name: '喜茶',
    category: '奶茶饮品',
    rating: 4.9,
    ratingCount: 6200,
    monthlyOrders: 18000,
    deliveryFee: 6,
    deliveryTime: 30,
    minOrder: 20,
    emoji: '🧋',
    bgColor: '#6B5344',
    tags: ['人气爆款', '满30减3', '新品上架'],
    menuCategories: ['热销', '果茶', '奶茶', '季节限定'],
    menu: [
      { id: 'dpg', name: '多肉葡萄', description: '满满葡萄果肉，鲜甜爆汁，喜茶经典', price: 32, calories: 280, emoji: '🍇', menuCategory: '热销', popular: true },
      { id: 'zzmm', name: '芝芝莓莓', description: '草莓奶盖茶，芝士与莓果的完美相遇', price: 35, calories: 320, emoji: '🍓', menuCategory: '热销', popular: true },
      { id: 'bbk', name: '冰博克', description: '浓缩冰茶，一口下去极度清爽', price: 28, calories: 150, emoji: '🧊', menuCategory: '果茶' },
      { id: 'jbk', name: '金凤茶王', description: '经典招牌茶，香气悠长', price: 22, calories: 100, emoji: '🍵', menuCategory: '奶茶' },
      { id: 'scly', name: '四季春柠檬', description: '清新四季春搭配鲜柠檬，解腻提神', price: 25, calories: 120, emoji: '🍋', menuCategory: '季节限定' },
      { id: 'ht_nac', name: '奶茶布丁', description: '丝滑奶茶加手工布丁，甜蜜满满', price: 30, calories: 380, emoji: '🧋', menuCategory: '奶茶' },
    ],
  },
  {
    id: 'malatang',
    name: '张亮麻辣烫',
    category: '小吃零食',
    rating: 4.5,
    ratingCount: 2100,
    monthlyOrders: 6700,
    deliveryFee: 4,
    deliveryTime: 32,
    minOrder: 15,
    emoji: '🌶️',
    bgColor: '#cc0000',
    tags: ['减配送费', '辣度可选', '自由搭配'],
    menuCategories: ['热销', '蔬菜', '肉类', '丸类', '主食'],
    menu: [
      { id: 'mlt_zx', name: '麻辣烫自选（200g）', description: '任选食材，按重量计价，香辣鲜美', price: 18, calories: 400, emoji: '🍲', menuCategory: '热销', popular: true },
      { id: 'mlt_da', name: '麻辣烫大份（350g）', description: '大份实惠，食材丰富，一人食刚好', price: 30, calories: 680, emoji: '🍲', menuCategory: '热销' },
      { id: 'mlt_sw', name: '素丸（5颗）', description: '爽弹素丸，香味扑鼻', price: 5, calories: 120, emoji: '⚪', menuCategory: '丸类' },
      { id: 'mlt_nm', name: '牛肉丸（5颗）', description: '弹牙牛肉丸，鲜嫩多汁', price: 8, calories: 160, emoji: '🟤', menuCategory: '丸类' },
      { id: 'mlt_fm', name: '粉丝（份）', description: '晶莹剔透，吸满汤汁', price: 4, calories: 200, emoji: '🍝', menuCategory: '主食' },
    ],
  },
  {
    id: 'shaxian',
    name: '沙县小吃',
    category: '中式快餐',
    rating: 4.4,
    ratingCount: 890,
    monthlyOrders: 3200,
    deliveryFee: 2,
    deliveryTime: 20,
    minOrder: 10,
    emoji: '🥟',
    bgColor: '#4a90d9',
    tags: ['最低配送费', '快速出餐'],
    menuCategories: ['热销', '面食', '点心', '卤味'],
    menu: [
      { id: 'bm', name: '拌面', description: '经典沙县拌面，花生酱香浓醇厚', price: 8, calories: 420, emoji: '🍜', menuCategory: '热销', popular: true },
      { id: 'jz', name: '蒸饺（10个）', description: '手工蒸饺，皮薄馅大，鲜香多汁', price: 12, calories: 380, emoji: '🥟', menuCategory: '热销', popular: true },
      { id: 'lyt', name: '卤鸭腿', description: '软糯入味，卤香四溢', price: 15, calories: 340, emoji: '🦆', menuCategory: '卤味' },
      { id: 'hyj', name: '花生汤', description: '香浓花生汤，传统甜品', price: 6, calories: 180, emoji: '🥣', menuCategory: '点心' },
      { id: 'hsr', name: '海鲜炒面', description: '新鲜海鲜配炒面，鲜香十足', price: 18, calories: 520, emoji: '🍝', menuCategory: '面食' },
    ],
  },
  {
    id: 'burgerking',
    name: '汉堡王',
    category: '汉堡炸鸡',
    rating: 4.5,
    ratingCount: 5400,
    monthlyOrders: 12000,
    deliveryFee: 5,
    deliveryTime: 38,
    minOrder: 20,
    emoji: '👑',
    bgColor: '#D62300',
    tags: ['品牌店', '满40减6', '买一送一'],
    menuCategories: ['热销', '汉堡', '炸鸡', '小食'],
    menu: [
      { id: 'hb', name: '皇堡', description: '火烤牛肉饼，经典皇堡，厚实解馋', price: 32, calories: 620, emoji: '🍔', menuCategory: '热销', popular: true },
      { id: 'jrb', name: '鸡肉皇堡', description: '香嫩鸡肉饼，外酥里嫩，清淡鲜美', price: 28, calories: 480, emoji: '🍔', menuCategory: '汉堡' },
      { id: 'ycc', name: '洋葱圈（大）', description: '金黄酥脆，洋葱香甜，必点小食', price: 18, calories: 420, emoji: '🧅', menuCategory: '小食', popular: true },
      { id: 'bk_ts', name: '双层皇堡套餐', description: '双层皇堡 + 大薯 + 大可乐', price: 56, calories: 1200, emoji: '🎁', menuCategory: '热销' },
      { id: 'bk_jc', name: '辣鸡排堡', description: '香辣爆汁鸡排，重口味首选', price: 26, calories: 510, emoji: '🌶️', menuCategory: '炸鸡' },
    ],
  },
  {
    id: 'sushi',
    name: '一番寿司',
    category: '日料韩料',
    rating: 4.7,
    ratingCount: 1820,
    monthlyOrders: 4500,
    deliveryFee: 6,
    deliveryTime: 40,
    minOrder: 30,
    emoji: '🍣',
    bgColor: '#1a1a2e',
    tags: ['精选食材', '满50减8', '日式正宗'],
    menuCategories: ['热销', '手卷', '握寿司', '小食', '汤品'],
    menu: [
      { id: 'smgj', name: '三文鱼手卷', description: '新鲜三文鱼，搭配海苔饭团，鲜嫩香甜', price: 28, calories: 320, emoji: '🌯', menuCategory: '热销', popular: true },
      { id: 'yzs', name: '玉子烧（3块）', description: '日式甜蛋卷，口感细腻，甜咸适中', price: 18, calories: 210, emoji: '🍳', menuCategory: '热销', popular: true },
      { id: 'wzh', name: '味噌汤', description: '暖胃日式味噌汤，豆腐海带香浓', price: 12, calories: 80, emoji: '🍵', menuCategory: '汤品' },
      { id: 'jylr', name: '酱油溜鱼', description: '精选鱼片，酱油浸泡，鲜嫩入味', price: 35, calories: 290, emoji: '🐟', menuCategory: '握寿司' },
      { id: 'edb', name: '蟹棒手卷', description: '鲜甜蟹棒搭配蔬菜，清爽可口', price: 22, calories: 250, emoji: '🦀', menuCategory: '手卷' },
      { id: 'dc', name: '章鱼小丸子（6颗）', description: '外焦里嫩，章鱼鲜美，日式经典小食', price: 20, calories: 320, emoji: '🐙', menuCategory: '小食', popular: true },
    ],
  },
];

export function getRestaurantById(id: string): Restaurant | undefined {
  return restaurants.find(r => r.id === id);
}

export const CATEGORIES: Category[] = ['全部', '中式快餐', '汉堡炸鸡', '日料韩料', '奶茶饮品', '小吃零食'];
