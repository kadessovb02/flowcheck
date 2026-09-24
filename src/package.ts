import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.ts') ? '..' : '../..');
const metadata = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
export const version: string = metadata.version;
export const releasePackage = `${metadata.name}@${version}`;
