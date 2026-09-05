import type { FurnitureType, ModelDef } from './registry'

// Category words stay separate from object aliases: a kitchen cabinet must
// satisfy both terms to match a query such as “kitchen table”.
const CATEGORY_WORDS: Record<FurnitureType, string> = {
  BEDS: '床 床具 beds',
  SEATING: '座椅 坐具 seating',
  LIGHTING: '灯 灯具 照明 lighting',
  TABLES: '桌 桌子 桌几 tables',
  STORAGE: '收纳 储物 storage',
  KITCHEN: '厨房 kitchen',
  BATHROOM: '卫浴 浴室 bathroom',
  DECOR: '装饰 摆件 decor',
  OTHER: '其他 other',
}

const OBJECT_ALIASES: [RegExp, string][] = [
  [/\b(sofa|couch)\b/, '沙发 sofa couch'],
  [/\b(armchair|chair)\b/, '椅 椅子 chair'],
  [/\barmchair\b/, '扶手椅 armchair'],
  [/\bstool\b/, '凳 凳子 stool'],
  [/\bbench\b/, '长椅 长凳 bench'],
  [/\b(coffee table|table coffee)\b/, '茶几 coffee table'],
  [/\bside table\b/, '边桌 边几 side table'],
  [/\b(cabinet|wardrobe|dresser)\b/, '柜 柜子 cabinet'],
  [/\bwardrobe\b/, '衣柜 wardrobe'],
  [/\b(bookcase|bookshelf)\b/, '书柜 书架 bookcase bookshelf'],
  [/\bshelf\b/, '架 置物架 搁架 shelf'],
  [/\b(lamp|pendant|chandelier)\b/, '灯 灯具 照明 lamp light'],
  [/\b(lamp.*(floor|standing)|(floor|standing) lamp)\b/, '落地灯 floor lamp'],
  [/\b(lamp.*table|table lamp)\b/, '台灯 table lamp'],
  [/\b(pendant|chandelier|lamp.*ceiling)\b/, '吊灯 ceiling light'],
  [/\b(rug|carpet)\b/, '地毯 rug carpet'],
  [/\b(plant|cactus)\b/, '植物 绿植 盆栽 plant'],
  [/\b(pillow|cushion)\b/, '枕头 靠垫 抱枕 pillow cushion'],
  [/\b(fridge|refrigerator)\b/, '冰箱 fridge refrigerator'],
  [/\b(stove|oven)\b/, '灶 炉 stove oven'],
  [/\bsink\b/, '水槽 洗手池 sink'],
  [/\btoilet\b/, '马桶 坐便器 toilet'],
  [/\bbathtub\b/, '浴缸 bathtub'],
  [/\bshower\b/, '淋浴 shower'],
  [/\bmirror\b/, '镜 镜子 mirror'],
  [/\b(television|tv)\b/, '电视 television tv'],
  [/\b(pictureframe|frame)\b/, '相框 画框 picture frame'],
]

function normalize(text: string): string {
  return text.toLowerCase().replace(/kitchen(table|cabinet|counter)/g, 'kitchen $1')
    .replace(/[-_:]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Match every query term, including Chinese aliases and English synonyms. */
export function matchesModelSearch(model: ModelDef, query: string): boolean {
  const terms = normalize(query).split(' ').filter(Boolean)
  if (!terms.length) return true
  const name = normalize(model.name)
  const words = [name, normalize(model.brand), CATEGORY_WORDS[model.type]]
  for (const [pattern, aliases] of OBJECT_ALIASES) {
    if (pattern.test(name)) words.push(aliases)
  }
  // Names such as “Cabinet Bed” are bedside cabinets, not beds.
  if (model.type === 'BEDS') words.push('床 bed')
  if (model.type === 'TABLES' && /\bdesk\b/.test(name)) words.push('书桌 办公桌 desk')
  if (/\b(cabinet bed|bedside|nightstand)\b/.test(name)) words.push('床头柜 bedside nightstand')
  if ((model.type === 'TABLES' || /\bkitchen table\b/.test(name)) &&
      /\btable\b/.test(name) && !/\b(coffee|side|low|sink)\b/.test(name)) {
    words.push('餐桌 dining table')
  }
  const searchable = words.join(' ')
  return terms.every((term) => searchable.includes(term))
}
