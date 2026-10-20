import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const library = path.resolve(root, process.argv[2] ?? '../AI-Components');
const temporary = await mkdtemp(path.join(tmpdir(), 'ai-components-pack-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  // npm pack runs the library's prepack build. A content hash avoids stale npm tarball caches.
  const output = execFileSync(npm, ['pack', '--json', '--pack-destination', temporary], {
    cwd: library,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const jsonStart = output.indexOf('[\n');
  if (jsonStart < 0) throw new Error('npm pack did not return package metadata.');
  const [{ filename }] = JSON.parse(output.slice(jsonStart));
  const packed = path.join(temporary, filename);
  const hash = createHash('sha256')
    .update(await readFile(packed))
    .digest('hex')
    .slice(0, 12);
  const destination = `vendor/ai-components-react-${hash}.tgz`;
  await copyFile(packed, path.join(root, destination));
  const packagePath = path.join(root, 'package.json');
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'));
  manifest.dependencies['@ai-components/react'] = `file:${destination}`;
  await writeFile(packagePath, JSON.stringify(manifest, null, 2) + '\n');
  execFileSync(npm, ['install'], { cwd: root, stdio: 'inherit' });
  console.log(
    `Updated to ${destination}. Commit the tarball, package.json, and package-lock.json together.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
