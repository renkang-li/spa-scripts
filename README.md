# spa-scripts

CLI toolkit for batch Git workflows across the SPA workspace, with a lightweight local Web UI.

## Web UI

```bash
npm start
```

The server starts on `http://127.0.0.1:4310` and will auto-bump the port if it is already in use.

The branch workflow is now stricter by default:

- existing local branches are checked out directly
- existing remote branches are checked out and tracked locally
- brand new branches are created from the chosen base ref
- if any selected project has uncommitted changes, the whole batch stops before making changes

## Commands

```bash
npm run branch -- -a -b origin/master feature/checkout-funnel
npm run merge -- -p "spa-shop,spa-store" --title "feat: checkout funnel"
npm run version -- -a --dry-run
```

You can also use the unified entrypoint:

```bash
node ./cli.js branch [options]
node ./cli.js merge [options]
node ./cli.js version [options]
```

## Notes

- Workspace root defaults to the parent directory of this repo.
- You can override the workspace with `SPA_ROOT_DIR=/path/to/workspace`.
- `branch --base auto` tries `origin/master`, `origin/main`, `master`, `main`.
- `merge` requires a native Linux `glab` on your `PATH`.
