import sys, io, math, urllib.request
from PIL import Image, ImageDraw
name, cx, cy, z = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), 19
R = 2  # tiles each side
img = Image.new('RGB', ((2*R+1)*256, (2*R+1)*256))
for dx in range(-R, R+1):
    for dy in range(-R, R+1):
        url = f'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{cy+dy}/{cx+dx}'
        req = urllib.request.Request(url, headers={'User-Agent': 'appreciate-arcade-sitemap/1.0'})
        try:
            tile = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert('RGB')
            img.paste(tile, ((dx+R)*256, (dy+R)*256))
        except Exception as e:
            print('tile fail', dx, dy, e)
# 20 m grid so footprints can be measured off the image (z19 ≈ 0.231 m/px at this latitude)
lat = math.degrees(math.atan(math.sinh(math.pi*(1-2*(cy+0.5)/2**z))))
mpp = 156543.03392*math.cos(math.radians(lat))/2**z
d = ImageDraw.Draw(img)
step = 20/mpp
x0 = (2*R+1)*256/2; y0 = x0
k = -20
while x0 + k*step/1 < img.width:
    pass_ = None
    break
i = -50
while i <= 50:
    x = x0 + i*step; y = y0 + i*step
    if 0 <= x < img.width: d.line([(x,0),(x,img.height)], fill=(255,0,255), width=1)
    if 0 <= y < img.height: d.line([(0,y),(img.width,y)], fill=(255,0,255), width=1)
    i += 1
d.line([(x0-6,y0),(x0+6,y0)], fill=(255,255,0), width=3); d.line([(x0,y0-6),(x0,y0+6)], fill=(255,255,0), width=3)
img.save(f'{name}_sat.jpg', quality=88)
print(name, 'saved', img.size, 'm/px', round(mpp,3), 'grid 20m')
