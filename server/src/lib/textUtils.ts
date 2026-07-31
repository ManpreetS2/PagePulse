/**
 * Text normalization and similarity primitives used across the
 * section matcher, diff engine, and meaning comparison.
 */
import { createHash } from 'node:crypto';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'by', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'as', 'it', 'its', 'this', 'that', 'these',
  'those', 'from', 'will', 'would', 'can', 'could', 'should', 'has', 'have', 'had', 'do', 'does',
  'did', 'not', 'me', 'my', 'i', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she', 'his',
  'her', 'them', 'us', 'about', 'into', 'than', 'then', 'so', 'no', 'any', 'all', 'when', 'while',
  'please', 'alert', 'notify', 'tell', 'let', 'know', 'watch', 'monitor', 'track', 'changes', 'change'
]);

/** Lowercase, collapse whitespace, strip most punctuation. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\p{L}\p{N}\s.$%:/@-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[\s/]+/)
    .map((t) => t.replace(/^[.:-]+|[.:-]+$/g, ''))
    .filter((t) => t.length > 0);
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

/** Simple suffix-stripping stem so "requirements" matches "requirement". */
export function stem(token: string): string {
  return token
    .replace(/(ies)$/, 'y')
    .replace(/(sses)$/, 'ss')
    .replace(/(ing|edly|ed)$/, '')
    .replace(/(s)$/, '');
}

export function stemmedSet(text: string): Set<string> {
  return new Set(contentTokens(text).map(stem));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** How much of `needles` appears in `haystack` (containment, 0-1). */
export function containment(needles: Set<string>, haystack: Set<string>): number {
  if (needles.size === 0) return 0;
  let hit = 0;
  for (const x of needles) if (haystack.has(x)) hit++;
  return hit / needles.size;
}

/** Split text into sentences / standalone lines. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Split on sentence boundaries but keep decimals ("3.20") and
    // abbreviations from over-splitting via a lookahead for capital/quote.
    const parts = trimmed.split(/(?<=[.!?])\s+(?=[A-Z"'(])/);
    for (const p of parts) {
      const s = p.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** Token-level cosine similarity over stemmed content words. */
export function sentenceSimilarity(a: string, b: string): number {
  const ta = contentTokens(a).map(stem);
  const tb = contentTokens(b).map(stem);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const fa = new Map<string, number>();
  const fb = new Map<string, number>();
  for (const t of ta) fa.set(t, (fa.get(t) ?? 0) + 1);
  for (const t of tb) fb.set(t, (fb.get(t) ?? 0) + 1);
  let dot = 0;
  for (const [t, c] of fa) dot += c * (fb.get(t) ?? 0);
  const na = Math.sqrt([...fa.values()].reduce((s, c) => s + c * c, 0));
  const nb = Math.sqrt([...fb.values()].reduce((s, c) => s + c * c, 0));
  return dot / (na * nb);
}

/** Character 4-gram fingerprint similarity — robust to rewording of headings. */
export function shingleSimilarity(a: string, b: string, n = 4): number {
  const sa = shingles(normalize(a), n);
  const sb = shingles(normalize(b), n);
  return jaccard(sa, sb);
}

function shingles(text: string, n: number): Set<string> {
  const s = new Set<string>();
  if (text.length < n) {
    if (text) s.add(text);
    return s;
  }
  for (let i = 0; i <= text.length - n; i++) s.add(text.slice(i, i + n));
  return s;
}

const NEGATION_RE = /\b(not|no longer|never|cannot|can't|won't|isn't|aren't|doesn't|don't|without|except|excluding|unavailable|discontinued|closed|ineligible)\b/i;

export function hasNegation(sentence: string): boolean {
  return NEGATION_RE.test(sentence);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
