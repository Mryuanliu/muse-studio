import * as path from 'path';

/** Resolve the h5-output directory relative to the backend project root. */
export function resolveOutputDir(): string {
  const backendRoot = path.resolve(__dirname, '..');
  return path.resolve(backendRoot, process.env.OUTPUT_DIR || 'h5-output');
}
