/**
 * Style presets for AI renders (prompt-driven).
 *
 * Each option appends a short English fragment to the render prompt. The
 * fragments are deliberately phrased as *material / light / backdrop*
 * instructions so they steer the look WITHOUT fighting the structure-locking
 * base prompt (never mention adding/moving objects).
 *
 * UI labels are bilingual; fragments always stay English (the image model
 * follows English style direction most reliably).
 */

export interface PresetOption {
  id: string
  /** bilingual label, e.g. "赛璐璐 Cel" */
  label: string
  /** English prompt fragment appended when selected ('' = no-op) */
  fragment: string
}

export interface PresetGroup {
  id: string
  /** bilingual group label for the select's <span> */
  label: string
  options: PresetOption[]
}

export const PRESET_GROUPS: PresetGroup[] = [
  {
    id: 'style',
    label: '风格 Style',
    options: [
      // the default direction lives in the base prompt: photorealistic
      // interior photo — the fun is the cartoon→real contrast
      { id: 'none', label: '写实摄影 Photoreal', fragment: '' },
      {
        id: 'cinematic',
        label: '电影感 Cinematic',
        fragment:
          'Style: cinematic film still — anamorphic lens feel, dramatic directional light, subtle film grain, warm-teal color grade, movie-frame atmosphere.',
      },
      {
        id: 'anime',
        label: '手绘动画 Painted anime',
        fragment:
          'Style: hand-painted anime film background — delicate watercolor textures, warm nostalgic light, painterly details, storybook-film charm.',
      },
      {
        id: 'cyberpunk',
        label: '赛博霓虹 Cyberpunk',
        fragment:
          'Style: cyberpunk night interior — neon tube accents, glowing city signs outside the windows, magenta and cyan rim light, rainy night mood.',
      },
      {
        id: 'watercolor',
        label: '水彩插画 Watercolor',
        fragment:
          'Style: watercolor interior illustration — visible paper texture, loose wet-on-wet washes, softly bleeding edges, airy daylight.',
      },
      {
        id: 'clay',
        label: '粘土 Claymation',
        fragment:
          'Style: claymation stop-motion — handmade plasticine surfaces, soft rounded forms, miniature dollhouse set feel, warm and playful.',
      },
      {
        id: 'cel',
        label: '赛璐璐 Cel',
        fragment:
          'Style: anime cel-shading — crisp flat color fills, bold clean dark outlines, minimal gradients, vibrant Saturday-morning-cartoon look.',
      },
    ],
  },
  {
    id: 'light',
    label: '光线 Lighting',
    options: [
      { id: 'none', label: '自然日光 Daylight', fragment: '' },
      {
        id: 'golden',
        label: '黄昏 Golden hour',
        fragment:
          'Lighting: warm golden-hour sunlight streaming through the windows, long soft amber cartoon shadows.',
      },
      {
        id: 'morning',
        label: '清晨 Morning',
        fragment:
          'Lighting: soft cool morning light, fresh gentle atmosphere, pale blue-white tones.',
      },
      {
        id: 'overcast',
        label: '阴天 Overcast',
        fragment:
          'Lighting: overcast daylight, very soft diffused shadows, calm pastel mood.',
      },
      {
        id: 'night',
        label: '夜晚 Night',
        fragment:
          'Lighting: evening scene, warm interior lamps glowing, dark blue dusk outside the windows, cozy night mood.',
      },
    ],
  },
  {
    id: 'floor',
    label: '地板 Floor',
    options: [
      { id: 'none', label: '默认 Default', fragment: '' },
      {
        id: 'oak',
        label: '橡木 Oak',
        fragment: 'Floor: light oak wood flooring with subtle cartoon grain.',
      },
      {
        id: 'walnut',
        label: '胡桃木 Walnut',
        fragment: 'Floor: dark walnut wood flooring, rich brown tone.',
      },
      {
        id: 'herringbone',
        label: '人字拼 Herringbone',
        fragment: 'Floor: herringbone parquet wood flooring.',
      },
      {
        id: 'checker',
        label: '棋盘格 Checkerboard',
        fragment: 'Floor: playful two-tone checkerboard tile flooring.',
      },
      {
        id: 'tile',
        label: '瓷砖 Tile',
        fragment: 'Floor: large matte ceramic tile flooring.',
      },
    ],
  },
  {
    id: 'view',
    label: '窗景 View',
    options: [
      { id: 'none', label: '默认 Default', fragment: '' },
      {
        id: 'greenery',
        label: '绿植庭院 Greenery',
        fragment: 'Outside the windows: lush green garden and treetops.',
      },
      {
        id: 'city',
        label: '城市 City',
        fragment: 'Outside the windows: soft-focus cartoon city skyline.',
      },
      {
        id: 'sea',
        label: '海景 Sea',
        fragment: 'Outside the windows: calm blue sea horizon.',
      },
      {
        id: 'snow',
        label: '雪景 Snow',
        fragment: 'Outside the windows: quiet snowy landscape.',
      },
    ],
  },
]

/** English fragments for the current selection (skips empty 'none' options). */
export function presetFragments(selection: Record<string, string>): string[] {
  const out: string[] = []
  for (const group of PRESET_GROUPS) {
    const opt = group.options.find((o) => o.id === selection[group.id])
    if (opt?.fragment) out.push(opt.fragment)
  }
  return out
}

/** Bilingual label of one option (for captions/meta). */
export function presetLabel(groupId: string, optionId: string): string | null {
  const g = PRESET_GROUPS.find((x) => x.id === groupId)
  const o = g?.options.find((x) => x.id === optionId)
  return o && o.fragment ? o.label : null
}
