import sys, io, math, json, urllib.request
from PIL import Image, ImageDraw
site_id, lat_c, lng_c = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
z, R = 19, 2
n = 2 ** z
fx = (lng_c + 180) / 360 * n
fy = (1 - math.log(math.tan(math.radians(lat_c)) + 1 / math.cos(math.radians(lat_c))) / math.pi) / 2 * n
cx, cy = int(fx), int(fy)
img = Image.new('RGB', ((2 * R + 1) * 256, (2 * R + 1) * 256))
for dx in range(-R, R + 1):
    for dy in range(-R, R + 1):
        url = f'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{cy+dy}/{cx+dx}'
        t = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'appreciate-arcade-sitemap/1.0'}), timeout=30).read())).convert('RGB')
        img.paste(t, ((dx + R) * 256, (dy + R) * 256))
def px(lat, lng):
    x = (lng + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return ((x - (cx - R)) * 256, (y - (cy - R)) * 256)
d = ImageDraw.Draw(img)
sites = json.load(open('sites.json'))
s = next(x for x in sites if x['id'] == site_id)
MLAT = 111320; MLON = 111320 * math.cos(math.radians(s['lat']))
for i, b in enumerate(s['buildings']):
    pts = [px(s['lat'] - y / MLAT, s['lng'] + x / MLON) for x, y in b['poly']]
    d.line(pts + [pts[0]], fill=(255, 0, 255), width=3)
    mx = sum(p[0] for p in pts) / len(pts); my = sum(p[1] for p in pts) / len(pts)
    d.text((mx - 20, my - 6), b['addr'][:14], fill=(255, 255, 0))
for extra in sys.argv[4:]:
    la, ln = map(float, extra.split(','))
    x, y = px(la, ln); d.ellipse([x - 7, y - 7, x + 7, y + 7], outline=(0, 255, 255), width=3)
img.save(f'{site_id}_check.jpg', quality=85)
print('saved', f'{site_id}_check.jpg')
