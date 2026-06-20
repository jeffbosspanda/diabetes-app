import { lookupFood } from './foodDatabase.js';

const ZH_NUM = { '零':0,'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'半':0.5 };

function parseQty(str) {
  if (!str) return 1;
  const arabic = parseFloat(str);
  if (!isNaN(arabic)) return arabic;
  if (str === '半') return 0.5;
  const val = ZH_NUM[str];
  return val !== undefined ? val : 1;
}

function tokenize(text) {
  const normalized = text
    .replace(/[，,、；;＋+和及與跟]+/g, '|')
    .replace(/\s+/g, '|');
  return normalized.split('|').map(s => s.trim()).filter(Boolean);
}

// Common serving-unit words stripped after the quantity. Multi-char units
// (湯匙/茶匙…) are listed BEFORE single-char ones so the longest match wins.
const UNIT_WORDS = [
  '湯匙','茶匙','大匙','小匙',
  '碗','份','片','顆','個','條','塊','杯','匙','根','球','盤','碟','盒',
  '把','隻','尾','串','瓣','粒','撮','滴','包','罐','瓶','支','枝','朵','袋',
];

// Weight unit → gram multiplier.
// ORDER MATTERS: longest / most-specific patterns first so e.g. 「公斤」isn't
// matched as 「斤」, 「臺斤」isn't matched as 「斤」, 「kg」not as 「g」.
// 台制：1 台斤(臺斤/斤) = 600 g、1 兩 = 37.5 g。
const WEIGHT_UNITS = [
  { re: /公斤/, mult: 1000 },
  { re: /公克/, mult: 1 },
  { re: /臺斤/, mult: 600 },
  { re: /台斤/, mult: 600 },
  { re: /毫升/, mult: 1 },
  { re: /[kK][gG]/, mult: 1000 },
  { re: /斤/,  mult: 600 },
  { re: /兩/,  mult: 37.5 },
  { re: /克/,  mult: 1 },
  { re: /[gG]/, mult: 1 },
  { re: /[mM][lL]/, mult: 1 },
  { re: /cc/,  mult: 1 },
];

// Direct carb declaration — the user states the carb amount themselves, so the
// system never has to guess (avoids "無法判斷"). Matches e.g.
// 「碳水50」「碳水50g」「50克碳水」「醣30」「糖25公克」.
const CARB_WORD = '(?:碳水化合物|碳水|醣類|醣|糖)';
function extractCarbDeclaration(token) {
  // "<word><num><unit?>"
  let m = token.match(new RegExp(`^${CARB_WORD}\\s*(\\d+(?:\\.\\d+)?)\\s*(?:公克|克|[gG])?$`));
  if (m) return { carbsG: parseFloat(m[1]) };
  // "<num><unit?><word>"
  m = token.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(?:公克|克|[gG])?\\s*${CARB_WORD}$`));
  if (m) return { carbsG: parseFloat(m[1]) };
  return null;
}

// Returns { weightG, foodText } or null
function extractWeight(token) {
  for (const { re, mult } of WEIGHT_UNITS) {
    // "<num><unit><food>"  e.g. "200g白飯", "200公克白飯"
    const re1 = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${re.source}\\s*(.+)$`);
    const m1 = token.match(re1);
    if (m1) return { weightG: parseFloat(m1[1]) * mult, foodText: m1[2].trim() };

    // "<food><num><unit>"  e.g. "白飯200g", "白飯200公克"
    const re2 = new RegExp(`^(.+?)\\s*(\\d+(?:\\.\\d+)?)\\s*${re.source}$`);
    const m2 = token.match(re2);
    if (m2) return { weightG: parseFloat(m2[2]) * mult, foodText: m2[1].trim() };
  }
  return null;
}

const QTY_CHARS = '0-9０-９半一二兩三四五六七八九十';
const UNIT_ALT = UNIT_WORDS.join('|');

function extractQtyAndFood(token) {
  const match = token.match(new RegExp(`^([${QTY_CHARS}]{0,3})([^${QTY_CHARS}]*)$`));
  if (match) {
    const rawQty = match[1];
    let rest = match[2].trim();
    for (const u of UNIT_WORDS) {
      if (rest.startsWith(u)) { rest = rest.slice(u.length).trim(); break; }
    }
    if (rawQty) return { qty: parseQty(rawQty) || 1, foodText: rest || token };
  }
  // No leading quantity → try TRAILING "<food><qty><unit?>" e.g. 「方糖兩顆」「香蕉3根」
  const tail = token.match(new RegExp(`^(.+?)([${QTY_CHARS}]{1,3})(?:${UNIT_ALT})?$`));
  if (tail) {
    return { qty: parseQty(tail[2]) || 1, foodText: tail[1].trim() || token };
  }
  return { qty: 1, foodText: token };
}

// Returns per-food breakdown for carb-weighted BG impact / glycemic analysis.
// Each entry: { name, carbs, protein, fat, gi }
export function parseMealFoods(text) {
  if (!text?.trim()) return [];
  const tokens = tokenize(text);
  const result = [];

  for (const token of tokens) {
    // ① User-declared carbs ("碳水50") — exact, never guessed.
    const decl = extractCarbDeclaration(token);
    if (decl) {
      result.push({ name: `自述碳水 ${decl.carbsG}g`, carbs: decl.carbsG, protein: 0, fat: 0, gi: null, declared: true });
      continue;
    }
    const wt = extractWeight(token);
    if (wt) {
      const food = lookupFood(wt.foodText) || trySubstring(wt.foodText);
      if (food) {
        const scale = wt.weightG / (food.gram || 100);
        result.push({
          name: wt.foodText,
          carbs:   Math.round(food.carbs   * scale * 10) / 10,
          protein: Math.round(food.protein * scale * 10) / 10,
          fat:     Math.round(food.fat     * scale * 10) / 10,
          gi:      food.gi ?? null,
        });
      } else {
        result.push({ name: wt.foodText, undetermined: true });
      }
      continue;
    }
    const { qty, foodText } = extractQtyAndFood(token);
    const food = lookupFood(foodText) || trySubstring(foodText);
    if (food) {
      result.push({
        name: foodText,
        carbs:   Math.round(food.carbs   * qty * 10) / 10,
        protein: Math.round(food.protein * qty * 10) / 10,
        fat:     Math.round(food.fat     * qty * 10) / 10,
        gi:      food.gi ?? null,
      });
    } else {
      result.push({ name: foodText || token, undetermined: true });
    }
  }
  return result;
}

export function parseMealText(text) {
  if (!text.trim()) return null;

  const tokens = tokenize(text);
  const matched = [];
  const unmatched = [];
  let declaredCarbs = 0;     // carbs the user stated directly
  const declaredLabels = [];

  for (const token of tokens) {
    // ① User-declared carbs ("碳水50", "葡萄糖 30g" via DB, etc.) — never guessed.
    const decl = extractCarbDeclaration(token);
    if (decl) {
      declaredCarbs += decl.carbsG;
      declaredLabels.push(`自述碳水 ${decl.carbsG}g`);
      continue;
    }

    // ② Try weight extraction
    const wt = extractWeight(token);
    if (wt) {
      const food = lookupFood(wt.foodText) || trySubstring(wt.foodText);
      if (food) {
        // Scale nutrition: inputWeight / db-serving-gram
        const scale = wt.weightG / (food.gram || 100);
        matched.push({ food, scale, weightG: wt.weightG, label: `${wt.foodText}(${wt.weightG}g)` });
        continue;
      }
      unmatched.push(wt.foodText);
      continue;
    }

    // ③ Otherwise qty + food
    const { qty, foodText } = extractQtyAndFood(token);
    const food = lookupFood(foodText) || trySubstring(foodText);
    if (food) {
      matched.push({ food, scale: qty, label: foodText });
    } else {
      unmatched.push(foodText || token);
    }
  }

  // Nothing recognized AND no declared carbs → carbs genuinely undetermined.
  // Do NOT silently report 0 g (that would mislead dose calculation).
  if (!matched.length && declaredCarbs === 0) {
    return {
      foods: [], carbs: 0, protein: 0, fat: 0, calories: 0, highGI: [],
      diabetesNotes: '系統無法從描述判斷碳水量，請改用「手動輸入」填寫碳水，或直接描述碳水量（例：碳水50）／份量（例：白飯一碗、200g）。',
      confidence: 'undetermined', undetermined: true, unmatched,
    };
  }

  let carbs = declaredCarbs, protein = 0, fat = 0, calories = declaredCarbs * 4;
  const foodNames = [...declaredLabels];
  const highGI = [];

  for (const { food, scale, label } of matched) {
    carbs    += food.carbs    * scale;
    protein  += food.protein  * scale;
    fat      += food.fat      * scale;
    calories += food.calories * scale;
    foodNames.push(label || food.name);
    if (food.gi >= 70 && !highGI.find(h => h.name === food.name)) {
      highGI.push({ name: food.name, gi: food.gi, warning: giWarning(food.gi) });
    }
  }

  let notes = buildNotes(carbs, highGI, fat);
  if (unmatched.length) {
    notes = `部分項目無法判斷（${unmatched.join('、')}），其碳水未計入，總量可能低估；可補述份量或改用手動輸入。` + (notes ? `；${notes}` : '');
  }
  // partial = some items recognized but others undetermined → totals may undercount.
  const confidence = unmatched.length === 0 ? 'high'
    : 'partial';

  return {
    foods: [...new Set(foodNames)],
    carbs:    Math.round(carbs),
    protein:  Math.round(protein),
    fat:      Math.round(fat),
    calories: Math.round(calories),
    highGI,
    diabetesNotes: notes,
    confidence,
    undetermined: false,
    partial: unmatched.length > 0,
    unmatched,
  };
}

function trySubstring(foodText) {
  // Only substrings of length ≥2 — single-char fragments produce false matches
  // (and real single-char foods like 飯/蛋/菜 already hit the exact lookup).
  for (let len = foodText.length; len >= 2; len--) {
    for (let start = 0; start <= foodText.length - len; start++) {
      const sub = foodText.slice(start, start + len);
      const candidate = lookupFood(sub);
      if (candidate) return candidate;
    }
  }
  return null;
}

function giWarning(gi) {
  if (gi >= 85) return '極高GI，血糖上升非常快速，建議大幅減少份量';
  if (gi >= 75) return '高GI，建議搭配蛋白質或蔬菜延緩血糖上升';
  return '偏高GI，注意份量控制';
}

function buildNotes(carbs, highGI, fat) {
  const parts = [];
  if (carbs > 80) parts.push('本餐碳水較高，建議注射前再確認血糖');
  if (carbs < 20) parts.push('碳水量偏低，注意避免低血糖');
  if (highGI.length > 0) parts.push(`含高GI食物（${highGI.map(h => h.name).join('、')}），血糖上升較快，建議注射後 10–15 分鐘再進食`);
  if (fat > 30) parts.push('脂肪較高，可能延遲血糖高峰 2–4 小時');
  if (parts.length === 0) parts.push('本餐營養均衡，依計算劑量注射即可');
  return parts.join('；');
}
