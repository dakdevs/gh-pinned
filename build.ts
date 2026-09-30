import { build } from 'esbuild'
import stylex from '@stylexjs/unplugin'
import { appendFile, copyFile, mkdir, readFile, rm } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
const result = await build({
  entryPoints: ['src/content.tsx'],
  outfile: 'dist/content.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome111',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  metafile: true,
  legalComments: 'linked',
  plugins: [
    stylex.esbuild({
      useCSSLayers: false,
      importSources: ['@stylexjs/stylex'],
      unstable_moduleResolution: { type: 'commonJS' },
    }),
  ],
})

const packages = new Set(
  Object.keys(result.metafile.inputs).flatMap((file) => {
    const name = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//u.exec(file)?.[1]

    return name === undefined ? [] : [name]
  }),
)

// StyleX distributes an already bundled copy of styleq without its notice.
if (packages.has('@stylexjs/stylex')) {
  packages.add('styleq')
}

const licenses = await Promise.all(
  [...packages].map((name) => {
    const file =
      name === '@stylexjs/stylex' ? 'licenses/stylex-LICENSE.txt' : `node_modules/${name}/LICENSE`

    return readFile(file, 'utf8')
  }),
)

await appendFile('dist/content.js.LEGAL.txt', `\n${[...new Set(licenses)].join('\n')}`)
await copyFile('manifest.json', 'dist/manifest.json')
await copyFile('LICENSE', 'dist/LICENSE')
console.log('Built unpacked extension in dist/')
