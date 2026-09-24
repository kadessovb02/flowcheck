import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.ts') ? '..' : '../..');
export const version: string = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
export const releasePackage = `https://github.com/kadessovb02/flowcheck/releases/download/v${version}/flowcheck.tgz`;
