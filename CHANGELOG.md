# Changelog

## 0.1.0 (first preview)

- VS Code extension that runs a local MCP server at `http://127.0.0.1:3917/mcp`. VS Code's agent mode finds it automatically.
- 13 tools: `scan_project`, `list_presets`, `create_effect`, `edit_effect`, `validate`, `lint_performance`,
  `apply_changes`, `discard_changes`, `list_pending_changes`, `open_in_snowstorm`, `share_link`,
  `attach_to_entity`, `key_into_animation`.
- Layered effects. The root file controls timing and starts the other layers from its timeline. Only the root loops.
- 6 presets: impact, explosion, aura, trail, vortex, glitch.
- Changes are shown as a diff and saved only after you approve them. Overwritten files are backed up to
  `.snow_golem/backups/`. Saving stops if a file changed on disk or has unsaved edits, and snow_golem never
  writes outside the project folder.
- Command-line mode without VS Code: `node dist/cli.js --root <addon>`, over stdio or HTTP.

## 0.1.1 

- DOCS update