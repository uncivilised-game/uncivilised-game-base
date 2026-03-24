import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const config = {
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'game.js',
  format: 'iife',
  target: ['es2020'],
  sourcemap: true,
  banner: {
    js: `/*
 * UNCIVILISED — The Ancient Era
 * Built from src/ modules via esbuild
 */`,
  },
};

if (isWatch) {
  const context = await esbuild.context(config);
  await context.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(config);
  console.log('Build complete: game.js');
}
