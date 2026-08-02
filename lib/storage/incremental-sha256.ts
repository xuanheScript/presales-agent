const SHA256_BLOCK_BYTES = 64
const DEFAULT_HASH_CHUNK_BYTES = 4 * 1024 * 1024

const roundConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

export class IncrementalSha256 {
  private readonly state = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ])
  private readonly buffer = new Uint8Array(SHA256_BLOCK_BYTES)
  private readonly words = new Uint32Array(64)
  private bufferLength = 0
  private bytesHashed = 0
  private finished = false

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('SHA-256 已完成，不能继续写入')

    this.bytesHashed += data.byteLength
    let offset = 0

    if (this.bufferLength > 0) {
      const needed = SHA256_BLOCK_BYTES - this.bufferLength
      const copied = Math.min(needed, data.byteLength)
      this.buffer.set(data.subarray(0, copied), this.bufferLength)
      this.bufferLength += copied
      offset += copied

      if (this.bufferLength === SHA256_BLOCK_BYTES) {
        this.compress(this.buffer)
        this.bufferLength = 0
      }
    }

    while (offset + SHA256_BLOCK_BYTES <= data.byteLength) {
      this.compress(data.subarray(offset, offset + SHA256_BLOCK_BYTES))
      offset += SHA256_BLOCK_BYTES
    }

    if (offset < data.byteLength) {
      this.buffer.set(data.subarray(offset), 0)
      this.bufferLength = data.byteLength - offset
    }

    return this
  }

  digestHex(): string {
    if (!this.finished) this.finish()
    return Array.from(this.state, (word) => word.toString(16).padStart(8, '0')).join('')
  }

  private finish() {
    const bitLength = this.bytesHashed * 8
    this.buffer[this.bufferLength++] = 0x80

    if (this.bufferLength > 56) {
      this.buffer.fill(0, this.bufferLength)
      this.compress(this.buffer)
      this.bufferLength = 0
    }

    this.buffer.fill(0, this.bufferLength, 56)
    const highBits = Math.floor(bitLength / 0x1_0000_0000)
    const lowBits = bitLength >>> 0
    const view = new DataView(this.buffer.buffer)
    view.setUint32(56, highBits, false)
    view.setUint32(60, lowBits, false)
    this.compress(this.buffer)
    this.finished = true
  }

  private compress(block: Uint8Array) {
    const view = new DataView(block.buffer, block.byteOffset, block.byteLength)
    for (let index = 0; index < 16; index += 1) {
      this.words[index] = view.getUint32(index * 4, false)
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = this.words[index - 15]
      const previous2 = this.words[index - 2]
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3)
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10)
      this.words[index] = (
        this.words[index - 16] + sigma0 + this.words[index - 7] + sigma1
      ) >>> 0
    }

    let a = this.state[0]
    let b = this.state[1]
    let c = this.state[2]
    let d = this.state[3]
    let e = this.state[4]
    let f = this.state[5]
    let g = this.state[6]
    let h = this.state[7]

    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temporary1 = (h + sigma1 + choice + roundConstants[index] + this.words[index]) >>> 0
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sigma0 + majority) >>> 0

      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }

    this.state[0] = (this.state[0] + a) >>> 0
    this.state[1] = (this.state[1] + b) >>> 0
    this.state[2] = (this.state[2] + c) >>> 0
    this.state[3] = (this.state[3] + d) >>> 0
    this.state[4] = (this.state[4] + e) >>> 0
    this.state[5] = (this.state[5] + f) >>> 0
    this.state[6] = (this.state[6] + g) >>> 0
    this.state[7] = (this.state[7] + h) >>> 0
  }
}

export async function sha256File(
  file: Blob,
  options: {
    chunkSize?: number
    signal?: AbortSignal
    onProgress?: (bytesHashed: number, bytesTotal: number) => void
  } = {},
): Promise<string> {
  const chunkSize = options.chunkSize ?? DEFAULT_HASH_CHUNK_BYTES
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('SHA-256 分片大小必须为正整数')
  }

  const hasher = new IncrementalSha256()
  let offset = 0
  while (offset < file.size) {
    options.signal?.throwIfAborted()
    const end = Math.min(offset + chunkSize, file.size)
    const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer())
    hasher.update(chunk)
    offset = end
    options.onProgress?.(offset, file.size)
  }
  options.signal?.throwIfAborted()
  return hasher.digestHex()
}
