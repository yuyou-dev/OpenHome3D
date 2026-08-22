#!/usr/bin/env python3
"""Draw a synthetic 两室一厅 floor plan PNG for testing multimodal floor-plan extraction.

Ground truth (meters), origin top-left, y pointing south:
  outer: 8.4 x 7.2
  主卧 master  : x 0.0-3.6, y 0.0-3.4  (3.6 x 3.4)
  次卧 bedroom2: x 0.0-3.6, y 3.4-7.2  (3.6 x 3.8)
  厨房 kitchen : x 3.6-6.0, y 0.0-2.6  (2.4 x 2.6)
  卫生间 bath  : x 6.0-8.4, y 0.0-2.6  (2.4 x 2.6)
  客厅 living  : x 3.6-8.4, y 2.6-7.2  (4.8 x 4.6)
Doors (all 0.9 wide except entrance 1.0):
  entrance: south wall (y=7.2), x 7.3-8.3
  master: wall x=3.6, y 2.3-3.2 (opens to living)
  bedroom2: wall x=3.6, y 4.0-4.9
  kitchen: wall y=2.6, x 4.2-5.1
  bath: wall y=2.6, x 6.6-7.5
Windows:
  master north wall x 1.0-2.6; bedroom2 south wall x 1.0-2.6
  living east wall y 3.6-5.6; kitchen north wall x 4.2-5.4; bath north wall x 6.6-7.4
"""
from PIL import Image, ImageDraw, ImageFont

S = 90  # px per meter
M = 90  # margin px for dimension lines
W, H = 8.4, 7.2
img = Image.new('RGB', (int(W * S) + 2 * M, int(H * S) + 2 * M), 'white')
d = ImageDraw.Draw(img)

def X(x): return M + x * S
def Y(y): return M + y * S

WALL = 10  # wall stroke px
BLACK = (30, 30, 30)

def font(sz):
    for p in ('/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Light.ttc'):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            continue
    return ImageFont.load_default()

F_LBL = font(30)
F_DIM = font(24)

# wall segments with door/window gaps; each entry: (x0,y0,x1,y1, gaps[(a,b,kind)])
walls = [
    (0.0, 0.0, 8.4, 0.0, [(1.0, 2.6, 'win'), (4.2, 5.4, 'win'), (6.6, 7.4, 'win')]),  # north
    (0.0, 7.2, 8.4, 7.2, [(1.0, 2.6, 'win'), (7.3, 8.3, 'door')]),                    # south
    (0.0, 0.0, 0.0, 7.2, []),                                                          # west
    (8.4, 0.0, 8.4, 7.2, [(3.6, 5.6, 'win')]),                                          # east
    (3.6, 0.0, 3.6, 7.2, [(2.3, 3.2, 'door'), (4.0, 4.9, 'door')]),                     # inner vertical
    (3.6, 2.6, 8.4, 2.6, [(0.6, 1.5, 'door'), (3.0, 3.9, 'door')]),                     # inner horizontal
    (6.0, 0.0, 6.0, 2.6, []),                                                           # kitchen|bath divider
    (0.0, 3.4, 3.6, 3.4, []),                                                           # master|bedroom2 divider
]

for x0, y0, x1, y1, gaps in walls:
    segs = []
    cur = x0 if x0 == x1 is False else None
    # parametrize along the wall
    horizontal = y0 == y1
    length = (x1 - x0) if horizontal else (y1 - y0)
    spans = []
    t = 0.0
    for a, b, kind in sorted(gaps):
        spans.append((t, a, 'wall'))
        spans.append((a, b, kind))
        t = b
    spans.append((t, length, 'wall'))
    for a, b, kind in spans:
        if b - a < 1e-6:
            continue
        if horizontal:
            p0, p1 = (X(x0 + a), Y(y0)), (X(x0 + b), Y(y0))
        else:
            p0, p1 = (X(x0), Y(y0 + a)), (X(x0), Y(y0 + b))
        if kind == 'wall':
            d.line([p0, p1], fill=BLACK, width=WALL)
        elif kind == 'win':
            # opening + two thin lines
            if horizontal:
                d.line([(p0[0], p0[1] - 4), (p1[0], p1[1] - 4)], fill=BLACK, width=2)
                d.line([(p0[0], p0[1] + 4), (p1[0], p1[1] + 4)], fill=BLACK, width=2)
            else:
                d.line([(p0[0] - 4, p0[1]), (p1[0] - 4, p1[1])], fill=BLACK, width=2)
                d.line([(p0[0] + 4, p0[1]), (p1[0] + 4, p1[1])], fill=BLACK, width=2)
        elif kind == 'door':
            # gap + swing arc (centered at hinge) + leaf line
            r = (b - a) * S
            if horizontal:
                d.arc([p0[0] - r, p0[1] - r, p0[0] + r, p0[1] + r], 270, 360, fill=(120, 120, 120), width=2)
                d.line([(p0[0], p0[1]), (p0[0], p0[1] - r)], fill=(120, 120, 120), width=2)
            else:
                d.arc([p0[0] - r, p0[1] - r, p0[0] + r, p0[1] + r], 0, 90, fill=(120, 120, 120), width=2)
                d.line([(p0[0], p0[1]), (p0[0] + r, p0[1])], fill=(120, 120, 120), width=2)

# room labels
labels = [
    (1.8, 1.5, '主卧', '12.2m²'),
    (1.8, 5.1, '次卧', '13.7m²'),
    (4.8, 1.1, '厨房', '6.2m²'),
    (7.2, 1.1, '卫生间', '6.2m²'),
    (6.0, 4.7, '客厅', '22.1m²'),
]
for cx, cy, name, area in labels:
    wn = d.textlength(name, font=F_LBL)
    wa = d.textlength(area, font=F_DIM)
    d.text((X(cx) - wn / 2, Y(cy) - 26), name, fill=BLACK, font=F_LBL)
    d.text((X(cx) - wa / 2, Y(cy) + 10), area, fill=(90, 90, 90), font=F_DIM)

# overall dimension chains
d.line([(X(0), Y(7.2) + 45), (X(8.4), Y(7.2) + 45)], fill=BLACK, width=2)
for x in (0, 8.4):
    d.line([(X(x), Y(7.2) + 35), (X(x), Y(7.2) + 55)], fill=BLACK, width=2)
d.text((X(4.2) - 30, Y(7.2) + 52), '8400', fill=BLACK, font=F_DIM)
d.line([(X(0) - 45, Y(0)), (X(0) - 45, Y(7.2))], fill=BLACK, width=2)
for y in (0, 7.2):
    d.line([(X(0) - 55, Y(y)), (X(0) - 35, Y(y))], fill=BLACK, width=2)
t = d.textbbox((0, 0), '7200', font=F_DIM)
d.text((X(0) - 85, Y(3.6) - 12), '7200', fill=BLACK, font=F_DIM)

img.save('tmp-floorplan/plan-synthetic.png')
print('saved tmp-floorplan/plan-synthetic.png', img.size)
