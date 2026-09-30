type NavigationItem = {
  label: string
  section: string
  href?: string
  disabled?: boolean
  count?: number
}

type FixtureOptions = {
  repo?: string | null
  metadata?: string | null
  theme?: string
  header?: string
  navigation?: NavigationItem[]
  controls?: boolean
  tall?: boolean
  nativeSticky?: boolean
  nativeFixed?: boolean
  viewer?: string
  ownerLogin?: string
}

const defaultNavigation = [
  { label: 'Code', section: '' },
  { label: 'Issues', section: '/issues' },
  { label: 'Pull requests', section: '/pulls' },
  { label: 'Settings', section: '/settings' },
]

function repositoryNavigation(repo: string | null, items: NavigationItem[] = defaultNavigation) {
  if (repo === null) {
    return ''
  }

  const links = items.map((item) => {
    return `<a href="${item.href ?? `/${repo}${item.section}`}" ${item.disabled === true ? 'aria-disabled="true"' : ''}>${item.label}${item.count === undefined ? '' : `<span class="Counter" data-component="counter" aria-hidden="true">${item.count}</span>`}</a>`
  })

  return `<nav class="repo-nav" aria-label="Repository">${links.join('')}</nav>`
}

function globalHeader(header: string, repoNavigation: string) {
  const marketing = header === 'marketing'

  const wrapperStart = marketing ? '<react-partial><div data-color-mode="dark">' : ''

  const wrapperEnd = marketing ? '</div></react-partial>' : ''

  const nextRow =
    header === 'GlobalNav'
      ? `<h2 class="sr-only">Repository navigation</h2>${repoNavigation}`
      : '<div class="global-nav">Overview &nbsp;&nbsp; Repositories &nbsp;&nbsp; Projects &nbsp;&nbsp; Packages</div>'

  return `${wrapperStart}<header class="${marketing ? 'MarketingHeader' : header}" ${marketing ? 'data-marketing-header' : ''} role="banner">
      <div class="global-row Stack" data-component="Stack" data-direction="horizontal"><span class="global-mark">GitHub</span><span>Dashboard</span>
      <span class="global-search">Type / to search</span><span>＋</span></div>
      ${nextRow}
    </header>${wrapperEnd}`
}

function repositoryHeader(repo: string | null, header: string, repoNavigation: string) {
  if (repo === null) {
    return '<h1>GitHub</h1>'
  }

  return `<div id="repository-container-header"><a href="/${repo}">${repo}</a></div>
    ${header === 'GlobalNav' ? '' : repoNavigation}`
}

export function fixture(options: FixtureOptions = {}) {
  const { repo, theme, header, controls, tall, nativeSticky, nativeFixed, viewer, ownerLogin } = {
    repo: null,
    theme: 'light',
    header: 'GlobalNav',
    ...options,
  }

  const metadata = options.metadata === undefined ? repo : options.metadata

  const repoNavigation = repositoryNavigation(repo, options.navigation)

  return `<!doctype html>
    <html lang="en" data-color-mode="${theme}" data-light-theme="light" data-dark-theme="dark">
    <head><meta charset="utf-8"><title>GitHub fixture</title>
    ${metadata === null ? '' : `<meta name="octolytics-dimension-repository_nwo" content="${metadata}">`}
    ${viewer === undefined ? '' : `<meta name="user-login" content="${viewer}">`}
    ${ownerLogin === undefined ? '' : `<meta name="octolytics-dimension-user_login" content="${ownerLogin}">`}
    <style>
      :root {
        --bgColor-default: #ffffff; --bgColor-muted: #f6f8fa;
        --fgColor-default: #1f2328; --fgColor-muted: #59636e;
        --borderColor-default: #d1d9e0; --borderColor-muted: #d1d9e0b3;
        --bgColor-neutral-muted: rgba(129, 139, 152, 0.12); --fgColor-accent: #0969da;
        --borderColor-accent-emphasis: #0969da;
        --focus-outlineColor: #0969da; --underlineNav-borderColor-active: #fd8c73;
      }
      [data-color-mode="dark"] {
        --bgColor-default: #0d1117; --bgColor-muted: #151b23;
        --fgColor-default: #f0f6fc; --fgColor-muted: #9198a1;
        --borderColor-default: #3d444d; --borderColor-muted: #3d444db3;
        --bgColor-neutral-muted: #656c7633; --fgColor-accent: #4493f8;
        --borderColor-accent-emphasis: #1f6feb;
        --focus-outlineColor: #1f6feb;
      }
      * { box-sizing: border-box; }
      body { margin: 0; color: var(--fgColor-default); background: var(--bgColor-default);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
      .GlobalNav, .AppHeader, .Header, .MarketingHeader { padding: 16px 32px; background: var(--bgColor-muted);
        border-bottom: 1px solid var(--borderColor-default); }
      react-partial { display: block; }
      .global-row { display: flex; gap: 24px; align-items: center; min-height: 32px; }
      .global-mark { font-size: 22px; font-weight: 600; }
      .global-search { margin-left: auto; padding: 7px 14px; width: 280px;
        border: 1px solid var(--borderColor-default); border-radius: 6px; color: var(--fgColor-muted); }
      .global-nav { padding-top: 12px; color: var(--fgColor-muted); }
      .sr-only { position: absolute; width: 1px; height: 1px; padding: 0;
        overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
      main { padding: 28px 32px; }
      #repository-container-header { font-size: 20px; padding-bottom: 24px; }
      a { color: var(--fgColor-accent); text-decoration: none; }
      .repo-nav { display: flex; gap: 28px; border-bottom: 1px solid var(--borderColor-default); padding: 10px 0 16px; }
      .panel { margin-top: 24px; padding: 20px; border: 1px solid var(--borderColor-default); border-radius: 6px; }
      .panel p { color: var(--fgColor-muted); }
      ${tall === true ? '.panel { min-height: 1800px; }' : ''}
      ${nativeSticky === true ? '.GlobalNav { position: sticky; top: var(--native-top, 0px); z-index: 100; }' : ''}
      ${nativeFixed === true ? '.GlobalNav { position: fixed; left: 0; right: 0; height: 112px; top: var(--native-top, 0px); z-index: 100; } .native-fixed-reserve { height: 112px; }' : ''}
    </style></head>
    <body>${globalHeader(header, repoNavigation)}${nativeFixed === true ? '<div class="native-fixed-reserve" aria-hidden="true"></div>' : ''}<main>
      ${repositoryHeader(repo, header, repoNavigation)}
      <div class="panel"><strong>${repo ?? 'Your GitHub home'}</strong>
      <p>Controlled GitHub-style fixture for extension integration checks.</p>
      ${controls === true ? '<button id="fixture-control">Fixture control</button>' : ''}</div>
    </main></body></html>`
}
