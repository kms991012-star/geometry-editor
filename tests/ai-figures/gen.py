# 시험용 수학 도형 그림 7종 + 정답(JSON) 만들기 (2배로 그려서 줄여 부드러운 선)
import json, math, os
from PIL import Image, ImageDraw, ImageFont
OUT = os.path.dirname(os.path.abspath(__file__))
F = r'C:\Windows\Fonts'
K = 2
def font(name, size): return ImageFont.truetype(os.path.join(F, name), size * K)

class Fig:
    def __init__(s, name, w, h):
        s.name, s.w, s.h = name, w, h
        s.im = Image.new('RGB', (w * K, h * K), 'white'); s.d = ImageDraw.Draw(s.im)
        s.pts, s.objs = {}, []
    def P(s, name, x, y, label=True, dot=True, lpos=(0, -24)):
        s.pts[name] = (x, y)
        if dot: s.d.ellipse([(x - 4) * K, (y - 4) * K, (x + 4) * K, (y + 4) * K], fill='black')
        if label: s.text(name, x + lpos[0], y + lpos[1], 'timesi.ttf', 26)
        s.objs.append({'type': 'point', 'id': name, 'label': name if label else '', 'x': x, 'y': y})
    def text(s, t, x, y, f='times.ttf', size=24):
        fo = font(f, size); b = s.d.textbbox((0, 0), t, font=fo)
        s.d.text((x * K - (b[0] + b[2]) / 2, y * K - (b[1] + b[3]) / 2), t, font=fo, fill='black')
    def line(s, a, b, dashed=False, w=3):
        (x1, y1), (x2, y2) = s.pts[a], s.pts[b]
        if not dashed: s.d.line([x1 * K, y1 * K, x2 * K, y2 * K], fill='black', width=w * K)
        else:
            L = math.hypot(x2 - x1, y2 - y1); n = int(L / 12)
            for i in range(n):
                t0, t1 = i / n, (i + 0.55) / n
                s.d.line([(x1 + (x2 - x1) * t0) * K, (y1 + (y2 - y1) * t0) * K, (x1 + (x2 - x1) * t1) * K, (y1 + (y2 - y1) * t1) * K], fill='black', width=2 * K)
    def seg(s, a, b, dashed=False, ticks=0):
        s.line(a, b, dashed)
        o = {'type': 'segment', 'from': a, 'to': b, 'dashed': dashed}
        if ticks:
            o['ticks'] = ticks
            (x1, y1), (x2, y2) = s.pts[a], s.pts[b]; mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            L = math.hypot(x2 - x1, y2 - y1); ux, uy = (x2 - x1) / L, (y2 - y1) / L; nx, ny = -uy, ux
            for i in range(ticks):
                c = (i - (ticks - 1) / 2) * 6
                s.d.line([(mx + ux * c + nx * 8) * K, (my + uy * c + ny * 8) * K, (mx + ux * c - nx * 8) * K, (my + uy * c - ny * 8) * K], fill='black', width=2 * K)
        s.objs.append(o)
    def right(s, a, v, b, size=16):
        (ax, ay), (vx, vy), (bx, by) = s.pts[a], s.pts[v], s.pts[b]
        def u(px, py): L = math.hypot(px - vx, py - vy); return (px - vx) / L, (py - vy) / L
        u1, u2 = u(ax, ay), u(bx, by)
        p1 = (vx + u1[0] * size, vy + u1[1] * size); p3 = (vx + u2[0] * size, vy + u2[1] * size); p2 = (p1[0] + u2[0] * size, p1[1] + u2[1] * size)
        s.d.line([p1[0] * K, p1[1] * K, p2[0] * K, p2[1] * K, p3[0] * K, p3[1] * K], fill='black', width=2 * K)
        s.objs.append({'type': 'rightAngle', 'points': [a, v, b]})
    def length(s, a, b, val, off=(0, 0)):
        (x1, y1), (x2, y2) = s.pts[a], s.pts[b]
        s.text(val, (x1 + x2) / 2 + off[0], (y1 + y2) / 2 + off[1], 'times.ttf', 24)
        s.objs.append({'type': 'length', 'segment': [a, b], 'value': val})
    def angle(s, a, v, b, val, r=34):
        (ax, ay), (vx, vy), (bx, by) = s.pts[a], s.pts[v], s.pts[b]
        a1, a2 = math.atan2(ay - vy, ax - vx), math.atan2(by - vy, bx - vx)
        d = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        pts = [((vx + r * math.cos(a1 + d * t / 30)) * K, (vy + r * math.sin(a1 + d * t / 30)) * K) for t in range(31)]
        s.d.line(pts, fill='black', width=2 * K)
        m = a1 + d / 2; s.text(val, vx + (r + 22) * math.cos(m), vy + (r + 22) * math.sin(m), 'times.ttf', 22)
        s.objs.append({'type': 'angle', 'points': [a, v, b], 'value': val})
    def parallel(s, a, b, c, dd, count=1):
        for (p, q) in [(a, b), (c, dd)]:
            (x1, y1), (x2, y2) = s.pts[p], s.pts[q]; mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            L = math.hypot(x2 - x1, y2 - y1); ux, uy = (x2 - x1) / L, (y2 - y1) / L; nx, ny = -uy, ux
            for i in range(count):
                o = (i - (count - 1) / 2) * 8
                tip = (mx + ux * (o + 5), my + uy * (o + 5))
                s.d.line([(tip[0] - ux * 10 + nx * 7) * K, (tip[1] - uy * 10 + ny * 7) * K, tip[0] * K, tip[1] * K, (tip[0] - ux * 10 - nx * 7) * K, (tip[1] - uy * 10 - ny * 7) * K], fill='black', width=2 * K)
        s.objs.append({'type': 'parallel', 'segments': [[a, b], [c, dd]], 'count': count})
    def save(s):
        s.im.resize((s.w, s.h), Image.LANCZOS).save(os.path.join(OUT, s.name + '.png'))
        json.dump({'image': {'width': s.w, 'height': s.h}, 'objects': s.objs}, open(os.path.join(OUT, s.name + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# 1. 삼각형
f = Fig('1_triangle', 600, 450)
f.P('A', 300, 70); f.P('B', 110, 380, lpos=(-18, 18)); f.P('C', 500, 380, lpos=(18, 18))
f.seg('A', 'B'); f.seg('B', 'C'); f.seg('C', 'A'); f.save()
# 2. 직각삼각형 (직각 표시 + 길이)
f = Fig('2_right_triangle', 640, 420)
f.P('A', 140, 80, lpos=(-20, -14)); f.P('B', 140, 360, lpos=(-20, 16)); f.P('C', 520, 360, lpos=(20, 16))
f.seg('A', 'B'); f.seg('B', 'C'); f.seg('C', 'A'); f.right('A', 'B', 'C')
f.length('A', 'B', '6', (-22, 0)); f.length('B', 'C', '8', (0, 24)); f.length('C', 'A', '10', (18, -16)); f.save()
# 3. 사각형 (평행사변형 + 평행 표시)
f = Fig('3_quadrilateral', 700, 450)
f.P('A', 190, 90, lpos=(-16, -18)); f.P('D', 590, 90, lpos=(16, -18)); f.P('B', 110, 350, lpos=(-18, 16)); f.P('C', 510, 350, lpos=(18, 16))
f.seg('A', 'B'); f.seg('B', 'C'); f.seg('C', 'D'); f.seg('D', 'A'); f.parallel('A', 'D', 'B', 'C'); f.save()
# 4. 점과 선분이 여러 개 (중선, 점선 높이, 직각)
f = Fig('4_many_points', 620, 480)
f.P('A', 250, 70); f.P('B', 80, 400, lpos=(-18, 16)); f.P('C', 540, 400, lpos=(18, 16)); f.P('M', 310, 400, lpos=(0, 22)); f.P('H', 250, 400, lpos=(0, 22))
f.seg('A', 'B'); f.seg('B', 'H'); f.seg('H', 'M'); f.seg('M', 'C'); f.seg('C', 'A'); f.seg('A', 'M'); f.seg('A', 'H', dashed=True); f.right('A', 'H', 'C', 14); f.save()
# 5. 숫자가 표시된 도형 (직사각형 + 대각선 + cm)
f = Fig('5_numbers', 660, 440)
f.P('A', 120, 90, lpos=(-18, -14)); f.P('B', 120, 340, lpos=(-18, 16)); f.P('C', 540, 340, lpos=(18, 16)); f.P('D', 540, 90, lpos=(18, -14))
f.seg('A', 'B'); f.seg('B', 'C'); f.seg('C', 'D'); f.seg('D', 'A'); f.seg('A', 'C')
f.length('B', 'C', '12 cm', (0, 26)); f.length('A', 'B', '5 cm', (-40, 0)); f.length('A', 'C', '13 cm', (16, -18)); f.save()
# 6. 점 이름이 표시된 도형 (오각형)
f = Fig('6_labels', 680, 460)
cx, cy, R = 340, 240, 170
names = ['A', 'B', 'C', 'D', 'E']
for i, n in enumerate(names):
    a = -math.pi / 2 + i * 2 * math.pi / 5
    x, y = round(cx + R * math.cos(a)), round(cy + R * math.sin(a))
    f.P(n, x, y, lpos=(round(26 * math.cos(a)), round(26 * math.sin(a))))
for i in range(5): f.seg(names[i], names[(i + 1) % 5], ticks=1)
f.save()
# 7. 직각 표시가 있는 도형 (각도 + 직각)
f = Fig('7_right_marks', 600, 500)
f.P('A', 120, 420, lpos=(-18, 16)); f.P('B', 470, 420, lpos=(18, 16)); f.P('C', 470, 110, lpos=(18, -14)); f.P('D', 300, 420, lpos=(0, 22))
f.seg('A', 'D'); f.seg('D', 'B'); f.seg('B', 'C'); f.seg('C', 'A'); f.seg('C', 'D')
f.right('A', 'B', 'C'); f.angle('C', 'A', 'B', '40°', 60); f.save()
print('done')
# 8. 문자와 숫자가 여러 개 (변수·단위·각도·영역 이름)
f = Fig('8_texts', 700, 500)
f.P('A', 160, 420, lpos=(-18, 16)); f.P('B', 560, 420, lpos=(18, 16)); f.P('C', 300, 120, lpos=(0, -24))
f.seg('A', 'B'); f.seg('B', 'C'); f.seg('C', 'A')
f.length('A', 'B', '8 cm', (0, 26)); f.length('B', 'C', 'x', (20, -6)); f.length('C', 'A', '5 cm', (-34, -6))
f.angle('C', 'A', 'B', '60°', 50)
for (t, x, y) in [('S', 340, 330), ('y', 620, 200), ('(가)', 90, 80)]:
    f.text(t, x, y, 'timesi.ttf' if t in 'xyS' else 'malgun.ttf', 24); f.objs.append({'type': 'text', 'text': t, 'x': x, 'y': y})
f.save()
print('8 done')
