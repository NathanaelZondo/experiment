import { defineConfig } from 'vitest/config';

/**
 * Base Vitest configuration for the Angular unit-test runner
 * (picked up automatically by `ng test` via the builder's `runnerConfig` option).
 *
 * Why this file exists: the development machine also runs a large LM Studio
 * model (23 GB) alongside the toolchain. Forking one worker per CPU core
 * (Vitest's default) exhausts system memory and crashes workers with
 * "process out of memory". Running test files sequentially in a single
 * worker keeps the footprint small while preserving full test coverage.
 */
export default defineConfig({
  test: {
    // Run test files one at a time in a single worker process.
    fileParallelism: false
  }
});
