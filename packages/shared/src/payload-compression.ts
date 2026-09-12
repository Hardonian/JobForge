/**
 * JobForge High-Throughput Payload Compression
 * Transparently compresses large JSON payloads (>2KB) with Gzip + Base64 envelope wrapping.
 * Drastically reduces PostgreSQL WAL bloat, network transfer latency, and storage overhead.
 */

import * as zlib from 'node:zlib'

export interface CompressedPayloadEnvelope {
  __compressed: true
  __alg: 'gzip'
  __original_size_bytes: number
  __compressed_size_bytes: number
  __data: string
}

export function isCompressedPayload(payload: unknown): payload is CompressedPayloadEnvelope {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }
  const candidate = payload as Record<string, unknown>
  return (
    candidate.__compressed === true &&
    candidate.__alg === 'gzip' &&
    typeof candidate.__data === 'string'
  )
}

/**
 * Compress payload if JSON stringified size exceeds threshold (default: 2048 bytes)
 */
export function compressPayload<T = unknown>(
  payload: T,
  thresholdBytes: number = 2048
): T | CompressedPayloadEnvelope {
  if (payload === null || payload === undefined) {
    return payload
  }

  // If already compressed, return as is
  if (isCompressedPayload(payload)) {
    return payload
  }

  const jsonString = JSON.stringify(payload)
  const buffer = Buffer.from(jsonString, 'utf-8')

  if (buffer.length <= thresholdBytes) {
    return payload
  }

  const compressed = zlib.gzipSync(buffer)
  const base64Data = compressed.toString('base64')

  const envelope: CompressedPayloadEnvelope = {
    __compressed: true,
    __alg: 'gzip',
    __original_size_bytes: buffer.length,
    __compressed_size_bytes: compressed.length,
    __data: base64Data,
  }

  return envelope
}

/**
 * Transparently decompress payload if wrapped in a compression envelope
 */
export function decompressPayload<T = unknown>(payload: unknown): T {
  if (!isCompressedPayload(payload)) {
    return payload as T
  }

  try {
    const compressedBuffer = Buffer.from(payload.__data, 'base64')
    const decompressedBuffer = zlib.gunzipSync(compressedBuffer)
    const jsonString = decompressedBuffer.toString('utf-8')
    return JSON.parse(jsonString) as T
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    throw new Error(`Failed to decompress JobForge payload envelope: ${err.message}`)
  }
}
