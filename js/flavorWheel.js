// SCA 咖啡風味輪資料（靜態）：大類 → 中類 → 細項
// 每個節點的 key 是由上而下的 id 串接，例如 "fruity.berry.blueberry"，存在 brews.flavorNotes
// 大類顏色已用 dataviz 驗證工具檢查過深色背景（相鄰色差、色盲模擬、對比）；輪盤順序即相鄰順序，勿任意調換

const n = (id, zh, en, children = []) => ({ id, zh, en, children });

const TREE = [
  n('fruity', '水果', 'Fruity', [
    n('berry', '莓果', 'Berry', [
      n('blackberry', '黑莓', 'Blackberry'), n('raspberry', '覆盆子', 'Raspberry'),
      n('blueberry', '藍莓', 'Blueberry'), n('strawberry', '草莓', 'Strawberry'),
    ]),
    n('dried', '果乾', 'Dried Fruit', [n('raisin', '葡萄乾', 'Raisin'), n('prune', '黑棗乾', 'Prune')]),
    n('other', '其他水果', 'Other Fruit', [
      n('coconut', '椰子', 'Coconut'), n('cherry', '櫻桃', 'Cherry'), n('pomegranate', '石榴', 'Pomegranate'),
      n('pineapple', '鳳梨', 'Pineapple'), n('grape', '葡萄', 'Grape'), n('apple', '蘋果', 'Apple'),
      n('peach', '水蜜桃', 'Peach'), n('pear', '西洋梨', 'Pear'),
    ]),
    n('citrus', '柑橘', 'Citrus Fruit', [
      n('grapefruit', '葡萄柚', 'Grapefruit'), n('orange', '柳橙', 'Orange'),
      n('lemon', '檸檬', 'Lemon'), n('lime', '萊姆', 'Lime'),
    ]),
  ]),
  n('sour', '酸／發酵', 'Sour/Fermented', [
    n('sour', '酸', 'Sour', [
      n('aromatics', '酸香', 'Sour Aromatics'), n('acetic', '醋酸', 'Acetic Acid'),
      n('butyric', '丁酸', 'Butyric Acid'), n('isovaleric', '異戊酸', 'Isovaleric Acid'),
      n('citric', '檸檬酸', 'Citric Acid'), n('malic', '蘋果酸', 'Malic Acid'),
    ]),
    n('alcohol', '酒香／發酵', 'Alcohol/Fermented', [
      n('winey', '酒香', 'Winey'), n('whiskey', '威士忌', 'Whiskey'),
      n('fermented', '發酵', 'Fermented'), n('overripe', '過熟', 'Overripe'),
    ]),
  ]),
  n('green', '綠色／植物', 'Green/Vegetative', [
    n('oliveoil', '橄欖油', 'Olive Oil'),
    n('raw', '生味', 'Raw'),
    n('vegetative', '綠色植物', 'Green/Vegetative', [
      n('underripe', '未熟', 'Under-ripe'), n('peapod', '豌豆莢', 'Peapod'), n('fresh', '新鮮', 'Fresh'),
      n('darkgreen', '深綠', 'Dark Green'), n('vegetative', '蔬菜', 'Vegetative'),
      n('haylike', '乾草', 'Hay-like'), n('herblike', '香草植物', 'Herb-like'),
    ]),
    n('beany', '豆味', 'Beany'),
  ]),
  n('other', '其他', 'Other', [
    n('papery', '紙味／霉味', 'Papery/Musty', [
      n('stale', '陳腐', 'Stale'), n('cardboard', '紙板', 'Cardboard'), n('papery', '紙味', 'Papery'),
      n('woody', '木頭', 'Woody'), n('moldy', '潮濕發霉', 'Moldy/Damp'), n('dusty', '灰塵霉味', 'Musty/Dusty'),
      n('earthy', '土壤霉味', 'Musty/Earthy'), n('animalic', '動物味', 'Animalic'),
      n('meaty', '肉湯味', 'Meaty Brothy'), n('phenolic', '酚味', 'Phenolic'),
    ]),
    n('chemical', '化學味', 'Chemical', [
      n('bitter', '苦', 'Bitter'), n('salty', '鹹', 'Salty'), n('medicinal', '藥味', 'Medicinal'),
      n('petroleum', '石油味', 'Petroleum'), n('skunky', '臭鼬味', 'Skunky'), n('rubber', '橡膠', 'Rubber'),
    ]),
  ]),
  n('roasted', '烘焙', 'Roasted', [
    n('pipetobacco', '菸斗菸草', 'Pipe Tobacco'),
    n('tobacco', '菸草', 'Tobacco'),
    n('burnt', '焦味', 'Burnt', [
      n('acrid', '嗆辣', 'Acrid'), n('ashy', '灰燼', 'Ashy'),
      n('smoky', '煙燻', 'Smoky'), n('brownroast', '深烘焙', 'Brown, Roast'),
    ]),
    n('cereal', '穀物', 'Cereal', [n('grain', '穀粒', 'Grain'), n('malt', '麥芽', 'Malt')]),
  ]),
  n('spices', '香料', 'Spices', [
    n('pungent', '辛辣', 'Pungent'),
    n('pepper', '胡椒', 'Pepper'),
    n('brownspice', '棕色香料', 'Brown Spice', [
      n('anise', '茴香', 'Anise'), n('nutmeg', '肉豆蔻', 'Nutmeg'),
      n('cinnamon', '肉桂', 'Cinnamon'), n('clove', '丁香', 'Clove'),
    ]),
  ]),
  n('nutty', '堅果／可可', 'Nutty/Cocoa', [
    n('nutty', '堅果', 'Nutty', [n('peanuts', '花生', 'Peanuts'), n('hazelnut', '榛果', 'Hazelnut'), n('almond', '杏仁', 'Almond')]),
    n('cocoa', '可可', 'Cocoa', [n('chocolate', '巧克力', 'Chocolate'), n('darkchocolate', '黑巧克力', 'Dark Chocolate')]),
  ]),
  n('sweet', '甜', 'Sweet', [
    n('brownsugar', '紅糖', 'Brown Sugar', [
      n('molasses', '糖蜜', 'Molasses'), n('maple', '楓糖漿', 'Maple Syrup'),
      n('caramel', '焦糖', 'Caramelized'), n('honey', '蜂蜜', 'Honey'),
    ]),
    n('vanilla', '香草', 'Vanilla'),
    n('vanillin', '香草醛', 'Vanillin'),
    n('overall', '整體甜感', 'Overall Sweet'),
    n('aromatics', '甜香', 'Sweet Aromatics'),
  ]),
  n('floral', '花香', 'Floral', [
    n('blacktea', '紅茶', 'Black Tea'),
    n('floral', '花', 'Floral', [n('chamomile', '洋甘菊', 'Chamomile'), n('rose', '玫瑰', 'Rose'), n('jasmine', '茉莉', 'Jasmine')]),
  ]),
];

// 大類顏色（深色背景用，順序對應 TREE）
const COLORS = {
  fruity: '#c43f3e', sour: '#a7950f', green: '#258343', other: '#3991b7', roasted: '#955229',
  spices: '#bc598c', nutty: '#855e02', sweet: '#d87725', floral: '#9256a0',
};

// 實色格子上的字色：依 WCAG 對比選白或深色（較淺的黃、橘、藍、粉用深色字）
const DARK_INK = '#1c140f';
const INK = {
  fruity: '#fff', sour: DARK_INK, green: '#fff', other: DARK_INK, roasted: '#fff',
  spices: DARK_INK, nutty: '#fff', sweet: DARK_INK, floral: '#fff',
};

/** 補上 key、depth、color、ink、parent、葉節點數，並建立索引 */
const BY_KEY = new Map();
const ORDER = new Map(); // key → 在輪盤上的順序，用來排序已選風味
function build(node, parent, depth) {
  node.key = parent ? `${parent.key}.${node.id}` : node.id;
  node.depth = depth;
  node.parent = parent;
  const category = node.key.split('.')[0];
  node.color = COLORS[category];
  node.ink = INK[category];
  ORDER.set(node.key, ORDER.size);
  BY_KEY.set(node.key, node);
  node.children.forEach((c) => build(c, node, depth + 1));
  node.leaves = node.children.length ? node.children.reduce((s, c) => s + c.leaves, 0) : 1;
}
TREE.forEach((c) => build(c, null, 1));

export const FLAVOR_WHEEL = TREE;

export const isFlavorNote = (key) => BY_KEY.has(key);

/** 風味資訊：{ key, zh, en, color, depth, path: ['水果', '莓果', '藍莓'] }；不存在回傳 null */
export function flavorNote(key) {
  const node = BY_KEY.get(key);
  if (!node) return null;
  const path = [];
  for (let p = node; p; p = p.parent) path.unshift(p.zh);
  return { key, zh: node.zh, en: node.en, color: node.color, depth: node.depth, path };
}

/** 依輪盤順序排序並去除重複 */
export const sortFlavorNotes = (keys) =>
  [...new Set(keys)].filter(isFlavorNote).sort((a, b) => ORDER.get(a) - ORDER.get(b));
