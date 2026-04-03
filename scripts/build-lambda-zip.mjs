/**
 * Creates a Lambda deployment ZIP from .aws-sam/build/RepositoryFunction/
 * Output: .aws-sam/lambda-package.zip
 */
import { createWriteStream } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';

const SRC = resolve('.aws-sam/build/RepositoryFunction');
const OUT = resolve('.aws-sam/lambda-package.zip');

const archive = archiver('zip', { zlib: { level: 6 } });
const output = createWriteStream(OUT);

output.on('close', () => {
  const mb = (archive.pointer() / 1024 / 1024).toFixed(2);
  console.log(`✅ Lambda ZIP created: ${OUT} (${mb} MB)`);
});

archive.on('error', (err) => { throw err; });
archive.on('warning', (err) => { console.warn('Warning:', err.message); });

archive.pipe(output);
archive.directory(SRC, false);
await archive.finalize();
