# gh-pinned

A Chrome extension that embeds a React and TypeScript repository switcher at the viewport top on GitHub. All styling is authored in StyleX and compiled into the extension's CSS.

## Install

Use Node.js 22.18.0 or later to build the extension:

```sh
git clone https://github.com/dakdevs/gh-pinned.git
cd gh-pinned
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist` folder inside the cloned repository.
4. Refresh any open GitHub pages.

Visit a repository. Its current tab appears with a dashed outline and a **Pin** button. Pin it to keep it in the strip across visits. A saved tab is a single link containing the owner's avatar and repository name. Temporary tabs also have a separate **Pin** button with its own hover treatment and keyboard focus.

Right-click a saved tab, or focus it and press **Shift+F10**, then choose **Unpin repository** to open an **Unpin repository?** confirmation. The dialog identifies the full repository name and focuses **Cancel** first. Cancel, Escape, the close button, or clicking the backdrop keeps the pin. Confirming **Unpin** removes it; unpinning the current repository leaves it visible as a temporary tab.

Each tab shows the owner's GitHub avatar beside the repository name. Full `owner/repo` names remain in link destinations, accessible labels, tooltips, and storage, so repositories with the same name remain distinct. Avatars load from GitHub's public owner-image URLs; a small person icon replaces an unavailable image. Pin and unpin icons come directly from the official `@primer/octicons-react` package.

A counter after the repository name shows your open pull requests when GitHub provides a verified positive total for your signed-in account. It follows GitHub's native author filter, which also includes pull requests opened by Copilot on your behalf; see [GitHub's author-search announcement](https://github.blog/changelog/2026-06-18-copilot-authored-pull-requests-now-included-in-author-searches/). Zero, loading, unavailable, and signed-out results leave the badge hidden. Counts are kept in memory separately from pins and destination preferences.

The current repository keeps its selected underline throughout its subpages. Shortcuts initially open the repository's home page. Right-click a tab, or focus it and press **Shift+F10**, to choose where future clicks go. The menu lists only sections found in that repository's actual GitHub navigation. Selecting a section saves the preference without navigating or pinning a temporary tab. The preference uses the full `owner/repo` identity and updates across open GitHub tabs.

If a successful inspection finds the chosen section is no longer available, its saved destination is permanently reset to **Repo home**. A failed or incomplete inspection keeps the saved preference and offers a home-page fallback. Other repositories' preferences and pins are retained.

Pins stay in this browser profile's extension storage and update across open GitHub tabs. The strip scrolls horizontally when the shortcuts exceed the available width. It stays at the viewport top from its first render and throughout scrolling. A placeholder reserves its height above the page content, and overlapping native sticky navigation is moved below it.

## Install or update with an agent

From this checkout, run `npm ci` and `npm run build`. Installation automatically runs the `prepare` script for the default `@dakdevs/oxlint-plugin` setup. Use the browser's extension manager in Chrome or Dia, enable **Developer mode**, and choose **Load unpacked** with this checkout's `dist` folder.

For an existing installation, build into the same absolute `dist` path and use **Reload** on its existing extension card. Keeping that installation and extension ID preserves its stored pins and destinations. Refresh open GitHub pages after loading or reloading the extension.

Verify a temporary repository shows **Pin**, a saved tab opens its destination menu with **Unpin repository**, and choosing a destination leaves the current page open. Check the saved choice after a page refresh and cancel an unpin confirmation. Confirm the strip starts at the viewport top, leaves GitHub's global header accessible below it, and remains above native sticky navigation while scrolling.

## Build and verify

```sh
npm run check
npm run build
```

After a source change, rebuild, click **Reload** for this extension on `chrome://extensions`, and refresh GitHub. Do not edit generated files in `dist/`.

To run browser integration checks:

```sh
npx playwright install chromium
npm test
```

The suite loads the actual built Manifest V3 extension into isolated Chromium profiles. It verifies persistence, concurrent pins, temporary and selected states, split hover/focus, confirmation cancellation and modal focus, enabled-section discovery, saved destinations and permanent resets, personal PR counts and account changes, context-menu keyboard controls, sticky layout, soft navigation, header/body replacement, themes, and narrow-screen overflow. It writes fixture previews to `tests/artifacts/`.

Run **Oxfmt** with `npm run format` to format maintained files, or `npm run format:check` to check them. Its initializer settings use single quotes and omit semicolons. Run **Oxlint** with `npm run lint`; the lint configuration uses the default `defineConfig()` settings from `@dakdevs/oxlint-plugin`. The plugin is pinned to its GitHub revision in the lockfile.

`npm ci` runs the `prepare` script, which applies the `@effect/tsgo` Oxlint patch for the plugin's typed rules. `npm run typecheck` checks the app's strict TypeScript. `npm run check` combines type checking, linting, and formatting checks. Generated bundles and dependencies are excluded from direct formatting and linting.

## Implementation

- `src/content.tsx` mounts a React root and renders the switcher. GitHub repository metadata must agree with the URL, with a matching repository-header link as a fallback. `src/repository-store.ts` parses stored data with Zod at the extension-storage boundary. Schemas are constructed once at module scope after `src/zod.ts` sets `z.config({ jitless: true })`, because Manifest V3 blocks runtime compilation; see [Zod's CSP guidance](https://zod.dev/compile#content-security-policy).
- `src/styles.ts` recreates Primer's UnderlineNav, counters, and confirmation-dialog appearance using GitHub's CSS variables. The dashed temporary border and the current-repository underline are independent.
- `src/RepositoryMenu.tsx` renders the destination menu; `src/repository-navigation.ts` reads actual GitHub navigation from the current DOM or a same-origin authenticated fetch. Fetched HTML is parsed in a detached document and never injected or executed. Availability is refreshed on menu use and repository visits; concurrent requests are bounded and deduplicated.
- `src/pull-request-counts.ts` reads the signed-in viewer and fetches GitHub's native `/<owner>/<repo>/pulls/<viewer>` route with same-origin credentials. It validates the response's viewer, repository, route, and author filter before using the complete filtered `openCount`. Counts use a one-minute in-memory cache, deduplicated pending requests, and at most two concurrent fetches. Stale results refresh on relevant navigation, focus, or visibility changes; account changes abort pending work and discard the cache. GitHub's UI internals can change, so unrecognized responses or denied authentication leave the counter hidden.
- `src/sticky-bar.ts` keeps the bar fixed at the viewport top, reserves its height with a placeholder at the start of the body, and offsets overlapping native sticky navigation. It adds the measured bar height to the root's native `scroll-padding-top`, preserving target scroll margins for anchor links and `scrollIntoView`. GitHub's React PR file tree uses numeric scrolling; after a file selection, the extension adds the bar height once if the target still overlaps the strip or native sticky header. When the bar has no height, the original inline padding value and priority are restored, or the extension's declaration is removed.
- `build.mjs` uses esbuild and the official StyleX unplugin to produce `dist/content.js`, `dist/content.css`, and `dist/manifest.json`.
- Each permanent repository has its own `chrome.storage.local` key. There is no shared array that concurrent tabs can overwrite. Destination writes and automatic reset read/remove sequences share a per-repository Web Lock across normal GitHub tabs.
- The content script observes GitHub's Turbo events, DOM replacement, and the browser's navigation events to update the current repository and restore the same React root without duplicate strips.

The extension requests only `storage` and runs only on `https://github.com/*`. Section discovery and personal PR counts read GitHub repository pages in the current browser's access context. It requires no API token or server. GitHub Enterprise hosts are outside this version's scope. Removing the extension removes its pins and destination preferences.

## Design and platform references

- [Primer UnderlineNav](https://primer.style/product/components/underline-nav/) and its [official shared styles](https://github.com/primer/react/blob/main/packages/react/src/internal/components/UnderlineTabbedInterface.module.css) provide the navigation dimensions, neutral hover treatment, semibold selected label, coral underline, and inset focus ring.
- [Primer navigation accessibility](https://primer.style/product/components/underline-nav/accessibility/) supports a named navigation landmark, list, real links, and `aria-current`.
- [Primer's native Counter styles](https://github.com/primer/view_components/blob/main/app/components/primer/beta/counter.pcss) provide the PR badge dimensions and theme colors. The link's accessible description explains the personal count, following [CounterLabel accessibility guidance](https://primer.style/product/components/counter-label/accessibility/).
- [Primer Dialog](https://primer.style/product/components/dialog/) and its [accessibility guidance](https://primer.style/product/components/dialog/accessibility/) provide the confirmation layout, dismissal, and focus behavior. A native HTML dialog supplies modal focus containment and background inertness; its content is rendered in React and styled in StyleX.
- [GitHub Octicons](https://primer.style/octicons/) provide the pin and pin-slash icons.
- [StyleX's esbuild integration](https://stylexjs.com/docs/learn/installation/esbuild/) provides the build-time CSS extraction.
- [React createRoot](https://react.dev/reference/react-dom/client/createRoot) supports the embedded app.
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage), and [loading unpacked extensions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) document the platform behavior.

## License

The extension's original code is [MIT licensed](LICENSE). Bundled dependencies retain their own MIT licenses.
