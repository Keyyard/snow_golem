# Preset render harness (dev tool)

Renders effects with [Wintersky](https://github.com/JannisX11/wintersky) — the MIT-licensed engine Snowstorm uses —
ticking them the same way Snowstorm plays them, and saves contact sheets. This is the seed of a future
`render_frames` tool that lets the AI *see* its effects.

```bash
cd tools/render
npm init -y && npm i wintersky three@0.134 esbuild
npx esbuild harness.js --bundle --format=iife --outfile=harness.bundle.js
echo '<!doctype html><body style="margin:0"><script src="harness.bundle.js"></script>' > index.html
pip install playwright pillow && playwright install chromium
npm test --prefix ../..          # writes test/out/presets/
python shoot.py                  # or: python shoot.py aura glitch
```
