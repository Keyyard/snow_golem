import json, base64, io, sys, glob, os, threading, http.server, functools  # noqa
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
PRESET_DIR = os.path.join(HERE, '..', '..', 'test', 'out', 'presets', 'particles')
plan = {
  'impact':    dict(times=[0.03, 0.1, 0.22, 0.45], loop=False, distance=3.2, lookY=0.3),
  'explosion': dict(times=[0.05, 0.15, 0.4, 1.2],  loop=False, distance=7.5, lookY=1.0),
  'aura':      dict(times=[0.8, 1.6, 2.4, 3.2],    loop=True,  distance=4.0, lookY=0.8),
  'trail':     dict(times=[0.3, 0.6, 0.9, 1.2],    loop=True,  distance=2.4, lookY=0.2),
  'vortex':    dict(times=[0.5, 1.2, 2.0, 2.9],    loop=True,  distance=4.6, lookY=0.9),
  'glitch':    dict(times=[0.25, 0.5, 0.75, 1.1],  loop=True,  distance=4.0, lookY=0.9),
}
only = sys.argv[1:] or list(plan)
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=HERE)
httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
except Exception:
    font = ImageFont.load_default()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = b.new_page()
    page.on('console', lambda m: print('console:', m.text) if m.type in ('error','warning') else None)
    page.goto('http://127.0.0.1:8765/index.html')
    for name in only:
        files = {}
        for f in glob.glob(f'{PRESET_DIR}/{name}/*.particle.json'):
            j = json.load(open(f)); files[j['particle_effect']['description']['identifier']] = j
        cfg = plan[name]
        frames = page.evaluate('([f, r, t, o]) => renderEffect(f, r, t, o)', [files, f'demo:{name}', cfg['times'], cfg])
        tiles = []
        for fr in frames:
            im = Image.open(io.BytesIO(base64.b64decode(fr['png'].split(',')[1]))).convert('RGB')
            d = ImageDraw.Draw(im); d.text((8, 6), f"t={fr['t']}s  ·  {fr['particles']} particles", fill=(220,220,230), font=font)
            tiles.append(im)
        W = tiles[0].width
        sheet = Image.new('RGB', (W * len(tiles), W + 30), (14, 15, 18))
        for i, t in enumerate(tiles): sheet.paste(t, (i * W, 30))
        ImageDraw.Draw(sheet).text((8, 7), f"{name}  ({len(files)} layers, {'looping' if cfg['loop'] else 'one-shot'})", fill=(255,255,255), font=font)
        sheet.save(f'{OUT}/{name}.png'); print(name, [fr['particles'] for fr in frames])
    b.close()
httpd.shutdown()
