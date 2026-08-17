import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['test/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // One database container is shared by the whole run and tables are
    // truncated between files, so files must not run concurrently.
    fileParallelism: false,
    // Covers container startup + app boot on a cold run.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
  // Nest relies on `emitDecoratorMetadata`, which esbuild (Vitest's default
  // transformer) does not emit — without it every injected dependency
  // resolves to `Object` and the test module fails to instantiate.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
