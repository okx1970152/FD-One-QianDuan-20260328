import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const distDir = path.resolve(process.cwd(), 'dist');
const indexPath = path.join(distDir, 'index.html');
const managementPath = path.join(distDir, 'management.html');

await mkdir(distDir, { recursive: true });
await stat(indexPath);
await copyFile(indexPath, managementPath);

console.log(`Prepared ${path.relative(process.cwd(), managementPath)}`);
