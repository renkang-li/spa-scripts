# spa-scripts

CLI toolkit for batch Git workflows across the SPA workspace.

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
