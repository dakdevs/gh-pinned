# gh-pinned

Pin GitHub repositories in a shortcut strip at the top of the page. Tabs show owner avatars, repository names, and your open PR count when GitHub provides a verified total.

## Install

Requires Bun 1.4 or later and Chrome or Dia.

```sh
git clone https://github.com/dakdevs/gh-pinned.git
cd gh-pinned
bun install --frozen-lockfile
bun run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this checkout's `dist` folder. Refresh GitHub.

## Use

- Visit a repository and click **Pin** to keep it in the strip.
- Click a saved tab to open its destination.
- Right-click a saved tab, or press **Shift+F10** while focused, to choose a default destination or **Unpin repository**. Unpinning requires confirmation.

Pins and destinations sync across tabs in the same browser profile. A destination resets to **Repo home** if GitHub confirms that section is unavailable.

## Install or update with an agent

Run the install commands above. For an existing installation, rebuild into the same absolute `dist` path and click **Reload** on its existing extension card to preserve its ID, pins, and destinations. Refresh GitHub, then verify pinning, destination selection, canceled unpinning, and anchor targets below the sticky headers.

## Development

All maintained application, build, configuration, and test code is TypeScript. esbuild and StyleX generate the browser's JavaScript and CSS in `dist/`; do not edit those files.

```sh
bun run check                  # strict TypeScript, Oxlint, Oxfmt
bun run build
bunx --bun playwright install chromium
bun run test                   # checks, build, actual-extension browser tests
```

Tests use isolated Chromium profiles and save screenshots to `tests/artifacts/`. Run `bun run format` to format source. Reload the extension and refresh GitHub after rebuilding.

## Limitations

Works on `github.com`, not GitHub Enterprise. Requests only the `storage` permission; needs no API token or server. PR counts require a signed-in account and recognized GitHub markup. Removing the extension deletes its stored pins and destinations.

## License

[MIT](LICENSE). Bundled dependencies retain their own licenses.
