import { logger } from '../lib/logger'

export interface BodyPreviewResult {
  bodyPreview: string
  truncated: boolean
}

const METRICS_ENABLED = process.env.JOBFORGE_PREVIEW_METRICS === '1'
const METRICS_LOG_EVERY = Number(process.env.JOBFORGE_PREVIEW_METRICS_LOG_EVERY ?? 100)

const previewMetrics = {
  total: 0,
  truncated: 0,
  totalBytes: 0,
}

function recordPreviewMetrics(previewBytes: number, truncated: boolean): void {
  if (!METRICS_ENABLED) {
    return
  }

  previewMetrics.total += 1
  previewMetrics.totalBytes += previewBytes
  if (truncated) {
    previewMetrics.truncated += 1
  }

  if (previewMetrics.total % METRICS_LOG_EVERY === 0) {
    const averagePreviewBytes = previewMetrics.totalBytes / previewMetrics.total
    const truncationRate = previewMetrics.truncated / previewMetrics.total
    logger.info('response preview metrics', {
      preview_total: previewMetrics.total,
      preview_truncated_total: previewMetrics.truncated,
      preview_average_bytes: Math.round(averagePreviewBytes),
      preview_truncation_rate: Number(truncationRate.toFixed(4)),
    })
  }
}

export async function readBodyPreview(
  response: Response,
  maxBytes: number
): Promise<BodyPreviewResult> {
  const body = response.body

  if (!body || typeof (body as ReadableStream).getReader !== 'function') {
    const bodyText = await response.text()
    const bodyBytes = Buffer.byteLength(bodyText, 'utf8')
    if (bodyBytes > maxBytes) {
      recordPreviewMetrics(maxBytes, true)
      return {
        bodyPreview: bodyText.substring(0, maxBytes) + '... (truncated)',
        truncated: true,
      }
    }
    recordPreviewMetrics(bodyBytes, false)
    return { bodyPreview: bodyText, truncated: false }
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let receivedBytes = 0
  let truncated = false
  let bodyText = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (!value) {
        continue
      }

      const remaining = maxBytes - receivedBytes
      if (remaining <= 0) {
        truncated = true
        break
      }

      if (value.length > remaining) {
        bodyText += decoder.decode(value.subarray(0, remaining), { stream: true })
        receivedBytes += remaining
        truncated = true
        break
      }

      bodyText += decoder.decode(value, { stream: true })
      receivedBytes += value.length
    }
  } finally {
    if (truncated) {
      await reader.cancel()
    }
  }

  bodyText += decoder.decode()

  if (truncated) {
    recordPreviewMetrics(receivedBytes, true)
    return {
      bodyPreview: bodyText + '... (truncated)',
      truncated: true,
    }
  }

  recordPreviewMetrics(receivedBytes, false)
  return { bodyPreview: bodyText, truncated: false }
}
