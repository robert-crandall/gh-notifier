### Launching app

```
bun run tauri dev
```

This compiles Rust, starts the Vite dev server, and opens the desktop window. First run takes a few minutes while Rust dependencies compile.

### Manual testing (M1 — SQLite persistence)

The SQLite database is created at:
```
~/Library/Application Support/com.precision-architect.gh-notifier/gh-notifier.db
```

To inspect it directly:
```bash
sqlite3 ~/Library/Application\ Support/com.precision-architect.gh-notifier/gh-notifier.db
```

**Click-through test sequence:**
1. Launch the app with `bun run tauri dev`
2. Click **New Project** in the sidebar → enter a name → click Create
3. The project detail page opens — the project is now in SQLite
4. Edit the Context Document or Next Action fields
5. Quit and relaunch the app → the project and edits should still be there
6. Go to **Settings** → enter any token string → click Save
7. Quit and relaunch → the token field should show as `••••••••` (confirming persistence)
