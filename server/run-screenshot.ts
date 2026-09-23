import sharp from 'sharp'
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import germanLanguage from '@tesseract.js-data/deu'
import { DEFAULT_TIME_ZONE, dateKeyInTimeZone } from './time.js'

export type Confidence = 'high' | 'medium' | 'low'
export type RecognizedValue<T> = { value?: T; confidence: Confidence; note?: string }
export type RunScreenshotDraft = {
  environment: RecognizedValue<'indoor' | 'outdoor'>
  date: RecognizedValue<string>
  startTime: RecognizedValue<string>
  durationSeconds: RecognizedValue<number>
  distanceKm: RecognizedValue<number>
  displayedPaceSecondsPerKm: RecognizedValue<number>
  averageHeartRateBpm: RecognizedValue<number>
  effort: RecognizedValue<number>
  activeCalories: RecognizedValue<number>
  totalCalories: RecognizedValue<number>
  elevationGainM: RecognizedValue<number>
  averagePowerWatts: RecognizedValue<number>
  averageCadenceSpm: RecognizedValue<number>
}

const months: Record<string, number> = {
  jan: 1, januar: 1, feb: 2, februar: 2, mär: 3, maerz: 3, märz: 3, apr: 4, april: 4,
  mai: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, nov: 11, november: 11, dez: 12, dezember: 12,
}

const empty = <T>(): RecognizedValue<T> => ({ confidence: 'low', note: 'Nicht sicher erkannt' })
const found = <T>(value: T, confidence: Confidence = 'high', note?: string): RecognizedValue<T> => ({ value, confidence, ...(note ? { note } : {}) })
const number = (raw: string) => Number(raw.replace(',', '.'))
const integerAfter = (text: string, label: RegExp, suffix: string) => {
  const match = text.match(new RegExp(`${label.source}[\\s\\S]{0,45}?(\\d{1,5})(?:[,.]\\d+)?\\s*${suffix}`, 'i'))
  return match ? Number(match[1]) : undefined
}

export function inferGermanScreenshotDate(text: string, now = new Date(), timeZone = DEFAULT_TIME_ZONE): RecognizedValue<string> {
  const match = text.match(/(?:^|\s)(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]{3,12})\.?\s*(\d{4})?/i)
  if (!match) return empty()
  const month = months[match[2]!.toLocaleLowerCase('de-DE').replace(/\.$/, '')]
  if (!month) return empty()
  const day = Number(match[1])
  const today = dateKeyInTimeZone(now, timeZone)
  let year = match[3] ? Number(match[3]) : Number(today.slice(0, 4))
  let candidate = new Date(Date.UTC(year, month - 1, day))
  let value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (!match[3] && value > today) {
    year -= 1
    candidate = new Date(Date.UTC(year, month - 1, day))
    value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return empty()
  return match[3] ? found(value) : found(value, 'medium', 'Jahr aus dem jüngsten nicht zukünftigen Datum ergänzt')
}

export function parseRunScreenshotText(rawText: string, now = new Date(), timeZone = DEFAULT_TIME_ZONE): RunScreenshotDraft {
  const text = rawText.replace(/[|]/g, 'I').replace(/[–—]/g, '-').replace(/\r/g, '')
  const environment = /laufen\s*(?:outdoor|draußen)/i.test(text) ? found<'outdoor'>('outdoor')
    : /laufen\s*(?:indoor|drinnen|laufband)/i.test(text) ? found<'indoor'>('indoor') : empty<'indoor' | 'outdoor'>()
  const clock = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*-\s*(?:[01]?\d|2[0-3]):[0-5]\d\b/)
  const duration = text.match(/Trainingszeit[\s\S]{0,40}?\b(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)\b/i)
  const distance = text.match(/Strecke[\s\S]{0,45}?(\d{1,3}(?:[,.]\d{1,3})?)\s*K[MNH]\b/i)
  const pace = text.match(/(?:Ø|S|-)?\s*Pace[\s\S]{0,45}?(\d{1,2})\s*['’]\s*([0-5]\d)\s*["”]/i)
  const heart = text.match(/Herzfrequenz[\s\S]{0,35}?(\d{2,3})\s*[8B]PM\b/i)
  const effort = text.match(/Anstrengung[\s\S]{0,35}?\b(10|[1-9])\b/i)
  const activeCalories = integerAfter(text, /Aktivit[aä]tskilokalorien/i, 'KCAL')
  const totalCalories = integerAfter(text, /Gesamtkilokalorien/i, 'KCAL')
  const elevation = integerAfter(text, /H[oö]henmeter/i, 'M\\b')
  const power = integerAfter(text, /Leistung/i, 'W\\b')
  const cadence = integerAfter(text, /Kadenz/i, 'SPM\\b')
  return {
    environment,
    date: inferGermanScreenshotDate(text, now, timeZone),
    startTime: clock ? found(`${clock[1]!.padStart(2, '0')}:${clock[2]}`) : empty(),
    durationSeconds: duration ? found(Number(duration[1] ?? 0) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) : empty(),
    distanceKm: distance ? found(number(distance[1]!)) : empty(),
    displayedPaceSecondsPerKm: pace ? found(Number(pace[1]) * 60 + Number(pace[2])) : empty(),
    averageHeartRateBpm: heart ? found(Number(heart[1])) : empty(), effort: effort ? found(Number(effort[1])) : empty(),
    activeCalories: activeCalories === undefined ? empty() : found(activeCalories),
    totalCalories: totalCalories === undefined ? empty() : found(totalCalories),
    elevationGainM: elevation === undefined ? empty() : found(elevation),
    averagePowerWatts: power === undefined ? empty() : found(power),
    averageCadenceSpm: cadence === undefined ? empty() : found(cadence),
  }
}

let workerPromise: Promise<Worker> | undefined
let recognitionQueue: Promise<unknown> = Promise.resolve()
let activeRecognitions = 0
const MAX_ACTIVE_RECOGNITIONS = 2
function ocrWorker() {
  workerPromise ??= createWorker('deu', OEM.LSTM_ONLY, {
    langPath: germanLanguage.langPath,
    gzip: germanLanguage.gzip,
    cacheMethod: 'none',
  }).then(async (worker) => {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' })
    return worker
  }).catch((error) => { workerPromise = undefined; throw error })
  return workerPromise
}

export function supportedImageSignature(buffer: Buffer) {
  if (buffer.length < 12) return false
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true
  return buffer.subarray(4, 8).toString('ascii') === 'ftyp' && /heic|heix|heif|heis|hevc|hevx|mif1|msf1/i.test(buffer.subarray(8, 16).toString('ascii'))
}

export async function recognizeRunScreenshot(buffer: Buffer, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  if (!supportedImageSignature(buffer)) throw Object.assign(new Error('Bitte ein JPG-, PNG- oder HEIC-Bild auswählen.'), { code: 'UNSUPPORTED_IMAGE' })
  if (activeRecognitions >= MAX_ACTIVE_RECOGNITIONS) {
    throw Object.assign(new Error('Die Bilderkennung ist gerade ausgelastet. Bitte versuche es gleich erneut.'), { code: 'OCR_BUSY' })
  }
  activeRecognitions += 1
  try {
    let prepared: Buffer
    try {
      prepared = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, withoutEnlargement: true })
        .grayscale().negate().normalize().sharpen().png().toBuffer()
    } catch {
      throw Object.assign(new Error('Das Bild konnte nicht gelesen werden. HEIC wird auf diesem Server möglicherweise nicht unterstützt.'), { code: 'UNSUPPORTED_IMAGE' })
    }
    try {
      const worker = await ocrWorker()
      const task = recognitionQueue.then(() => worker.recognize(prepared))
      // Keep only the queue signal. Retaining the fulfilled OCR result here would
      // unnecessarily keep Tesseract's large page result alive between uploads.
      recognitionQueue = task.then(() => undefined, () => undefined)
      const result = await task
      return { draft: parseRunScreenshotText(result.data.text, now, timeZone) }
    } catch {
      throw Object.assign(new Error('Die Bilderkennung ist vorübergehend nicht verfügbar. Bitte versuche es erneut.'), { code: 'OCR_FAILED' })
    }
  } finally {
    activeRecognitions -= 1
  }
}
