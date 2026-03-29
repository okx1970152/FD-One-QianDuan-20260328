import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const distDir = path.resolve(process.cwd(), 'dist');
const indexPath = path.join(distDir, 'index.html');
const outputPath = path.join(distDir, 'ip9988001.html');

await mkdir(distDir, { recursive: true });
await stat(indexPath);
await copyFile(indexPath, outputPath);

console.log(`Prepared ${path.relative(process.cwd(), outputPath)}`);
