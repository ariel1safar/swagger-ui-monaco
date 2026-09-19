import { fileURLToPath } from 'node:url';

export function getAbsoluteFSPath(): string {
  return fileURLToPath(new URL('./assets/', import.meta.url));
}
export const absolutePath = getAbsoluteFSPath;
export default getAbsoluteFSPath;
