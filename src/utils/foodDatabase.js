// Food database — nutritional values per default serving
// gi: glycemic index (>70 = high GI)
// gram: default serving weight in grams
// carbs/protein/fat in grams, calories in kcal

export const FOOD_DB = [
  // ── 主食 ──
  { name: '白飯', aliases: ['米飯', '飯', '白米飯', '米'], unit: '碗', gram: 200, carbs: 46, protein: 4, fat: 0.4, calories: 232, gi: 72 },
  { name: '糙米飯', aliases: ['糙米', '玄米飯'], unit: '碗', gram: 200, carbs: 42, protein: 5, fat: 1.6, calories: 218, gi: 55 },
  { name: '稀飯', aliases: ['粥', '白粥', '米粥'], unit: '碗', gram: 250, carbs: 28, protein: 2, fat: 0.2, calories: 122, gi: 78 },
  { name: '麵條', aliases: ['麵', '油麵', '細麵', '陽春麵'], unit: '碗', gram: 200, carbs: 55, protein: 8, fat: 1, calories: 262, gi: 65 },
  { name: '拉麵', aliases: ['日式拉麵', '豬骨拉麵'], unit: '碗', gram: 250, carbs: 60, protein: 12, fat: 8, calories: 360, gi: 65 },
  { name: '烏龍麵', aliases: ['烏龍'], unit: '碗', gram: 200, carbs: 52, protein: 7, fat: 0.8, calories: 244, gi: 55 },
  { name: '米粉', aliases: ['炒米粉', '湯米粉', '粗米粉'], unit: '份', gram: 150, carbs: 46, protein: 3, fat: 0.5, calories: 202, gi: 61 },
  { name: '冬粉', aliases: ['綠豆冬粉', '粉絲'], unit: '份', gram: 100, carbs: 34, protein: 0.2, fat: 0.1, calories: 140, gi: 32 },
  { name: '吐司', aliases: ['土司', '白吐司'], unit: '片', gram: 30, carbs: 15, protein: 3, fat: 1, calories: 80, gi: 74 },
  { name: '全麥吐司', aliases: ['全麥土司', '全麥麵包'], unit: '片', gram: 30, carbs: 13, protein: 3.5, fat: 1, calories: 75, gi: 51 },
  { name: '饅頭', aliases: ['白饅頭'], unit: '個', gram: 80, carbs: 38, protein: 5, fat: 0.8, calories: 183, gi: 68 },
  { name: '包子', aliases: ['肉包', '菜包'], unit: '個', gram: 100, carbs: 35, protein: 8, fat: 5, calories: 225, gi: 55 },
  { name: '水餃', aliases: ['煮水餃', '蒸餃'], unit: '顆', gram: 30, carbs: 9, protein: 3, fat: 2, calories: 65, gi: 55 },
  { name: '鍋貼', aliases: ['煎餃'], unit: '顆', gram: 30, carbs: 9, protein: 3, fat: 3, calories: 74, gi: 55 },
  { name: '地瓜', aliases: ['番薯', '甘薯', '烤地瓜', '蒸地瓜'], unit: '條', gram: 150, carbs: 36, protein: 2, fat: 0.2, calories: 153, gi: 63 },
  { name: '馬鈴薯', aliases: ['洋芋', '薯'], unit: '顆', gram: 150, carbs: 30, protein: 3, fat: 0.2, calories: 135, gi: 78 },
  { name: '玉米', aliases: ['甜玉米', '玉蜀黍'], unit: '根', gram: 150, carbs: 30, protein: 4, fat: 1.5, calories: 150, gi: 55 },
  { name: '芋頭', aliases: ['芋'], unit: '塊', gram: 100, carbs: 24, protein: 2, fat: 0.2, calories: 107, gi: 55 },
  { name: '南瓜', aliases: ['金瓜'], unit: '份', gram: 100, carbs: 9, protein: 1, fat: 0.1, calories: 41, gi: 65 },
  { name: '蓮藕', aliases: ['藕'], unit: '份', gram: 100, carbs: 16, protein: 2, fat: 0.1, calories: 74, gi: 38 },

  // ── 常見料理 ──
  { name: '炒飯', aliases: ['蛋炒飯', '揚州炒飯', '什錦炒飯'], unit: '份', gram: 250, carbs: 58, protein: 10, fat: 10, calories: 362, gi: 72 },
  { name: '炒麵', aliases: ['炒意麵', '乾炒麵'], unit: '份', gram: 250, carbs: 60, protein: 12, fat: 8, calories: 360, gi: 65 },
  { name: '滷肉飯', aliases: ['焢肉飯', '控肉飯', '爌肉飯'], unit: '份', gram: 300, carbs: 55, protein: 14, fat: 18, calories: 440, gi: 72 },
  { name: '雞腿飯', aliases: ['烤雞腿飯', '滷雞腿飯'], unit: '份', gram: 350, carbs: 50, protein: 28, fat: 12, calories: 425, gi: 68 },
  { name: '排骨飯', aliases: ['炸排骨飯', '排骨便當'], unit: '份', gram: 350, carbs: 52, protein: 22, fat: 15, calories: 432, gi: 68 },
  { name: '便當', aliases: ['自助便當', '控肉便當'], unit: '份', gram: 400, carbs: 65, protein: 20, fat: 14, calories: 476, gi: 68 },
  { name: '牛肉麵', aliases: ['紅燒牛肉麵', '清燉牛肉麵'], unit: '碗', gram: 500, carbs: 62, protein: 25, fat: 10, calories: 440, gi: 62 },
  { name: '擔仔麵', aliases: ['台南擔仔麵'], unit: '碗', gram: 300, carbs: 45, protein: 12, fat: 6, calories: 284, gi: 62 },
  { name: '鹽酥雞', aliases: ['鹹酥雞', '炸雞塊'], unit: '份', gram: 150, carbs: 20, protein: 20, fat: 18, calories: 320, gi: 55 },
  { name: '雞排', aliases: ['炸雞排', '香雞排'], unit: '塊', gram: 200, carbs: 22, protein: 35, fat: 20, calories: 408, gi: 55 },
  { name: '臭豆腐', aliases: ['炸臭豆腐', '麻辣臭豆腐'], unit: '份', gram: 200, carbs: 14, protein: 16, fat: 12, calories: 228, gi: 40 },
  { name: '鹽水雞', aliases: ['白斬雞', '白切雞'], unit: '份', gram: 150, carbs: 2, protein: 28, fat: 8, calories: 196, gi: 0 },
  { name: '火鍋', aliases: ['麻辣鍋', '薑母鴨', '涮涮鍋'], unit: '份', gram: 500, carbs: 30, protein: 35, fat: 20, calories: 440, gi: 55 },
  { name: '壽司', aliases: ['握壽司', '捲壽司', '手卷'], unit: '個', gram: 60, carbs: 18, protein: 4, fat: 1.5, calories: 102, gi: 68 },
  { name: '拉麵叉燒', aliases: ['叉燒肉', '叉燒'], unit: '片', gram: 40, carbs: 2, protein: 10, fat: 5, calories: 92, gi: 35 },

  // ── 蛋白質 ──
  { name: '雞胸肉', aliases: ['清雞胸', '水煮雞胸', '雞胸'], unit: '份', gram: 150, carbs: 0, protein: 35, fat: 3, calories: 167, gi: 0 },
  { name: '雞腿肉', aliases: ['去骨雞腿', '雞腿'], unit: '份', gram: 150, carbs: 0, protein: 28, fat: 10, calories: 202, gi: 0 },
  { name: '豬里肌', aliases: ['豬里脊', '里肌肉'], unit: '份', gram: 150, carbs: 0, protein: 30, fat: 5, calories: 165, gi: 0 },
  { name: '豬五花', aliases: ['五花肉', '三層肉'], unit: '份', gram: 100, carbs: 0, protein: 15, fat: 28, calories: 312, gi: 0 },
  { name: '牛肉', aliases: ['牛排', '牛腱', '滷牛腱'], unit: '份', gram: 150, carbs: 0, protein: 30, fat: 8, calories: 191, gi: 0 },
  { name: '魚', aliases: ['魚片', '魚排', '鮭魚', '鱸魚', '虱目魚', '鯛魚'], unit: '份', gram: 150, carbs: 0, protein: 28, fat: 6, calories: 166, gi: 0 },
  { name: '蝦', aliases: ['草蝦', '白蝦', '蝦仁'], unit: '份', gram: 100, carbs: 1, protein: 20, fat: 1, calories: 93, gi: 0 },
  { name: '雞蛋', aliases: ['蛋', '水煮蛋', '荷包蛋', '炒蛋', '蒸蛋'], unit: '顆', gram: 60, carbs: 0.5, protein: 7, fat: 5, calories: 74, gi: 0 },
  { name: '豆腐', aliases: ['嫩豆腐', '板豆腐', '傳統豆腐'], unit: '塊', gram: 150, carbs: 3, protein: 8, fat: 4, calories: 80, gi: 15 },
  { name: '豆干', aliases: ['五香豆干', '黑豆干'], unit: '塊', gram: 50, carbs: 3, protein: 8, fat: 3, calories: 70, gi: 15 },
  { name: '毛豆', aliases: ['枝豆', '毛豆仁'], unit: '份', gram: 100, carbs: 10, protein: 12, fat: 5, calories: 135, gi: 18 },
  { name: '豬血糕', aliases: ['黑輪', '豬血'], unit: '塊', gram: 100, carbs: 22, protein: 6, fat: 1, calories: 121, gi: 78 },

  // ── 蔬菜 ──
  { name: '青菜', aliases: ['炒青菜', '燙青菜', '蔬菜', '菜'], unit: '份', gram: 100, carbs: 4, protein: 2, fat: 1, calories: 35, gi: 15 },
  { name: '花椰菜', aliases: ['綠花椰', '青花菜', '白花椰', '花菜'], unit: '份', gram: 100, carbs: 5, protein: 3, fat: 0.4, calories: 34, gi: 15 },
  { name: '菠菜', aliases: ['菠菜湯'], unit: '份', gram: 100, carbs: 3, protein: 3, fat: 0.4, calories: 26, gi: 15 },
  { name: '高麗菜', aliases: ['包心菜', '卷心菜', '甘藍'], unit: '份', gram: 100, carbs: 5, protein: 1, fat: 0.1, calories: 25, gi: 10 },
  { name: '番茄', aliases: ['大番茄', '牛番茄', '蕃茄'], unit: '顆', gram: 150, carbs: 6, protein: 1, fat: 0.3, calories: 28, gi: 30 },
  { name: '小番茄', aliases: ['聖女番茄', '小蕃茄'], unit: '份', gram: 100, carbs: 6, protein: 1, fat: 0.3, calories: 28, gi: 45 },
  { name: '小黃瓜', aliases: ['黃瓜', '胡瓜'], unit: '條', gram: 100, carbs: 3, protein: 1, fat: 0.1, calories: 16, gi: 15 },
  { name: '洋蔥', aliases: ['洋葱'], unit: '顆', gram: 150, carbs: 14, protein: 2, fat: 0.2, calories: 63, gi: 15 },
  { name: '紅蘿蔔', aliases: ['胡蘿蔔', '紅菜頭'], unit: '份', gram: 100, carbs: 10, protein: 1, fat: 0.2, calories: 45, gi: 39 },
  { name: '木耳', aliases: ['黑木耳', '白木耳'], unit: '份', gram: 100, carbs: 6, protein: 1, fat: 0.2, calories: 31, gi: 15 },
  { name: '香菇', aliases: ['冬菇', '椎茸', '菇類'], unit: '份', gram: 80, carbs: 4, protein: 2, fat: 0.3, calories: 24, gi: 10 },
  { name: '金針菇', aliases: ['金菇', '雪白菇'], unit: '份', gram: 100, carbs: 6, protein: 3, fat: 0.3, calories: 38, gi: 10 },

  // ── 水果 ──
  { name: '蘋果', aliases: ['青蘋果', '富士蘋果'], unit: '顆', gram: 200, carbs: 28, protein: 0.4, fat: 0.4, calories: 116, gi: 38 },
  { name: '香蕉', aliases: ['芭蕉'], unit: '根', gram: 120, carbs: 27, protein: 1.2, fat: 0.4, calories: 116, gi: 51 },
  { name: '橘子', aliases: ['柳橙', '柳丁', '橙子'], unit: '顆', gram: 200, carbs: 23, protein: 1.5, fat: 0.3, calories: 96, gi: 43 },
  { name: '西瓜', aliases: ['紅肉西瓜'], unit: '份', gram: 200, carbs: 14, protein: 1, fat: 0.2, calories: 62, gi: 72 },
  { name: '葡萄', aliases: ['巨峰葡萄', '黑葡萄'], unit: '份', gram: 150, carbs: 25, protein: 0.8, fat: 0.2, calories: 104, gi: 46 },
  { name: '芒果', aliases: ['愛文芒果', '土芒果'], unit: '份', gram: 150, carbs: 24, protein: 1, fat: 0.4, calories: 100, gi: 55 },
  { name: '鳳梨', aliases: ['菠蘿', '波蘿'], unit: '份', gram: 150, carbs: 19, protein: 0.8, fat: 0.2, calories: 81, gi: 59 },
  { name: '木瓜', aliases: [], unit: '份', gram: 150, carbs: 15, protein: 0.8, fat: 0.2, calories: 62, gi: 60 },
  { name: '奇異果', aliases: ['獼猴桃', 'kiwi'], unit: '顆', gram: 100, carbs: 15, protein: 1, fat: 0.5, calories: 63, gi: 52 },
  { name: '草莓', aliases: ['士多啤梨'], unit: '份', gram: 100, carbs: 8, protein: 1, fat: 0.3, calories: 38, gi: 40 },

  // ── 豆類 ──
  { name: '鸚嘴豆', aliases: ['雞豆', 'chickpea', '埃及豆', '雪蓮子'], unit: '份', gram: 150, carbs: 34, protein: 11, fat: 3, calories: 207, gi: 28 },
  { name: '紅豆', aliases: ['小紅豆', '紅豆湯'], unit: '份', gram: 100, carbs: 22, protein: 8, fat: 0.5, calories: 125, gi: 26 },
  { name: '綠豆', aliases: ['綠豆湯', '綠豆仁'], unit: '份', gram: 100, carbs: 20, protein: 8, fat: 0.5, calories: 116, gi: 25 },

  // ── 乳製品 ──
  { name: '牛奶', aliases: ['全脂牛奶', '鮮奶', '低脂牛奶'], unit: '杯', gram: 240, carbs: 12, protein: 8, fat: 8, calories: 148, gi: 31 },
  { name: '無糖優格', aliases: ['希臘優格', '原味優格', '優酪乳'], unit: '份', gram: 200, carbs: 8, protein: 12, fat: 3, calories: 107, gi: 36 },
  { name: '起司', aliases: ['乳酪', '起士', 'cheese'], unit: '片', gram: 20, carbs: 0.5, protein: 4, fat: 5, calories: 65, gi: 0 },

  // ── 飲料 ──
  { name: '豆漿', aliases: ['無糖豆漿', '黃豆漿'], unit: '杯', gram: 240, carbs: 8, protein: 9, fat: 4, calories: 104, gi: 34 },
  { name: '含糖豆漿', aliases: ['甜豆漿', '有糖豆漿'], unit: '杯', gram: 240, carbs: 22, protein: 9, fat: 4, calories: 160, gi: 44 },
  { name: '果汁', aliases: ['柳橙汁', '蘋果汁', '葡萄汁'], unit: '杯', gram: 240, carbs: 28, protein: 0.5, fat: 0.2, calories: 116, gi: 55 },
  { name: '含糖飲料', aliases: ['可樂', '汽水', '珍珠奶茶', '奶茶', '綠茶飲料', '紅茶'], unit: '杯', gram: 350, carbs: 42, protein: 0, fat: 0, calories: 168, gi: 63 },

  // ── 點心 / 甜食 ──
  { name: '蛋糕', aliases: ['海綿蛋糕', '戚風蛋糕', '起司蛋糕'], unit: '片', gram: 80, carbs: 36, protein: 4, fat: 8, calories: 232, gi: 77 },
  { name: '餅乾', aliases: ['蘇打餅', '消化餅', '米餅'], unit: '份', gram: 30, carbs: 22, protein: 1.5, fat: 4, calories: 130, gi: 70 },
  { name: '麵包', aliases: ['奶油麵包', '紅豆麵包', '克林姆麵包'], unit: '個', gram: 80, carbs: 40, protein: 5, fat: 6, calories: 234, gi: 70 },
  { name: '湯圓', aliases: ['元宵', '芝麻湯圓'], unit: '顆', gram: 35, carbs: 16, protein: 1, fat: 2, calories: 88, gi: 61 },
  { name: '年糕', aliases: ['甜年糕', '蘿蔔糕'], unit: '塊', gram: 100, carbs: 50, protein: 2, fat: 0.5, calories: 213, gi: 82 },
  { name: '粉圓', aliases: ['珍珠', '粉粿'], unit: '份', gram: 60, carbs: 28, protein: 0.2, fat: 0.1, calories: 114, gi: 85 },
  { name: '冰淇淋', aliases: ['雪糕', '霜淇淋'], unit: '球', gram: 65, carbs: 16, protein: 2, fat: 5, calories: 117, gi: 61 },

  // ── 油脂 / 調味 ──
  { name: '沙拉醬', aliases: ['美乃滋', '千島醬'], unit: '匙', gram: 15, carbs: 2, protein: 0.2, fat: 10, calories: 98, gi: 0 },
  { name: '花生醬', aliases: ['花生', '花生粉'], unit: '匙', gram: 20, carbs: 4, protein: 4, fat: 8, calories: 104, gi: 14 },
];

// Build lookup map: name/alias → entry
const _lookup = new Map();
FOOD_DB.forEach(item => {
  _lookup.set(item.name, item);
  item.aliases.forEach(a => _lookup.set(a, item));
});

export function lookupFood(keyword) {
  // Exact match first
  if (_lookup.has(keyword)) return _lookup.get(keyword);
  // Partial match
  for (const [key, item] of _lookup) {
    if (keyword.includes(key) || key.includes(keyword)) return item;
  }
  return null;
}
