import { rm } from 'node:fs/promises'

await rm('dist-server', { recursive: true, force: true })
