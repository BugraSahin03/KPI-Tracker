import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function keyFrom(value: string) {
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('PACE_TOKEN_ENCRYPTION_KEY muss 32 Byte Base64 sein.')
  return key
}

export function encryptToken(value: string, encodedKey: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(encodedKey), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

export function decryptToken(value: string, encodedKey: string) {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !encrypted) throw new Error('Ungültiges Tokenformat.')
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(encodedKey), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
