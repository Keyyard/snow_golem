# Third-party notices

snow_golem bundles these packages into `dist/`:

| Package | License | Author |
|---|---|---|
| [molangjs](https://github.com/JannisX11/MolangJS) | MIT | JannisX11 |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | Anthropic, PBC |
| [zod](https://github.com/colinhacks/zod) | MIT | Colin McDonnell |
| [jsonc-parser](https://github.com/microsoft/node-jsonc-parser) | MIT | Microsoft |
| [diff (jsdiff)](https://github.com/kpdecker/jsdiff) | BSD-3-Clause | Kevin Decker |

Previews run in [Snowstorm](https://github.com/JannisX11/snowstorm) (GPL-3.0, by JannisX11), which is
installed as a separate VS Code extension. snow_golem contains no Snowstorm code. The render tool in
`tools/render` uses [Wintersky](https://github.com/JannisX11/wintersky) (MIT, by JannisX11) and three.js (MIT).

The atlas map in `src/core/schema.ts` describes where textures sit in Minecraft's own particle atlas.
No Minecraft files are included. snow_golem is not affiliated with Mojang, Microsoft or JannisX11.
