import { build } from 'esbuild';

// Keep extension/ installable from a Git checkout, including the existing unpacked path.
await build({
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/manager.ts'],
  outdir: 'extension',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  charset: 'utf8',
  legalComments: 'none',
  banner: { js: '// Generated from src/*.ts by npm run build. Do not edit directly.' },
  logLevel: 'info'
});
