import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

await mkdir('dist-server/server/migrations', { recursive: true })
for (const file of await readdir('server/migrations')) {
  if (/^\d+_.*\.sql$/.test(file)) await copyFile(path.join('server/migrations', file), path.join('dist-server/server/migrations', file))
}

async function removeResourceForks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.name.startsWith('._')) await rm(target, { recursive: true, force: true })
    else if (entry.isDirectory()) await removeResourceForks(target)
  }
}
await removeResourceForks('dist-server')
