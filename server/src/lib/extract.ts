/**
 * Structured fact extraction: dates, times, prices, percentages, GPA
 * values, generic quantities, availability states, emails, and phone
 * numbers — each with the exact sentence it came from so alerts can show
 * real evidence.
 */
import type { Fact } from '../types.js';
import { splitSentences } from './textUtils.js';

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
};

const MONTH_RE = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';

// "September 30, 2026" / "Sep 30" / "30 September 2026" / "2026-09-30" / "9/30/2026"
const DATE_RES: RegExp[] = [
  new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi'),
  new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`, 'gi'),
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g
];

const TIME_RE = /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/gi;
const PRICE_RE = /(?:\$|us\$|usd\s?|€|£)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/gi;
const PERCENT_RE = /\b(\d{1,3}(?:\.\d{1,2})?)\s?%/g;
const GPA_RE = /\b([0-4]\.\d{1,2})\b/g;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const QUANTITY_RE = /\b(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)\s+(credits?|units?|semester|quarter|hours?|days?|weeks?|years?|students?|letters?|recommendations?|words?|pages?|items?|seats?|spots?)\b/gi;

const AVAILABLE_RE = /\b(in stock|available now|back in stock|available|restocked)\b/i;
const UNAVAILABLE_RE = /\b(out of stock|sold out|unavailable|discontinued|backordered|not available|currently not available)\b/i;

/** Size tokens used to attach availability facts to a product variant. */
const SIZE_RE = /\b(xxs|xs|s|m|l|xl|xxl|2xl|3xl|small|medium|large|extra small|extra large|one size)\b/i;

const SIZE_CANON: Record<string, string> = {
  'extra small': 'XS', small: 'S', medium: 'M', large: 'L', 'extra large': 'XL',
  xxs: 'XXS', xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL', xxl: 'XXL', '2xl': 'XXL', '3xl': '3XL', 'one size': 'One Size'
};

export function canonicalSize(raw: string): string {
  return SIZE_CANON[raw.toLowerCase()] ?? raw.toUpperCase();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function makeDateFact(sentence: string, raw: string, year: number | null, month: number, day: number): Fact {
  const y = year ?? new Date().getUTCFullYear();
  const value = year ? `${year}-${pad(month)}-${pad(day)}` : `${pad(month)}-${pad(day)}`;
  return {
    type: 'date',
    raw,
    value,
    sortKey: Date.UTC(y, month - 1, day),
    context: null,
    sentence
  };
}

function extractDates(sentence: string): Fact[] {
  const facts: Fact[] = [];
  const seen = new Set<string>();
  const push = (f: Fact) => {
    if (!seen.has(f.raw)) {
      seen.add(f.raw);
      facts.push(f);
    }
  };
  for (const [i, re] of DATE_RES.entries()) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence)) !== null) {
      const raw = m[0];
      if (i === 0) {
        const month = MONTHS[m[1]!.toLowerCase()];
        const day = Number(m[2]);
        const year = m[3] ? Number(m[3]) : null;
        if (month && day >= 1 && day <= 31) push(makeDateFact(sentence, raw, year, month, day));
      } else if (i === 1) {
        const day = Number(m[1]);
        const month = MONTHS[m[2]!.toLowerCase()];
        const year = m[3] ? Number(m[3]) : null;
        if (month && day >= 1 && day <= 31) push(makeDateFact(sentence, raw, year, month, day));
      } else if (i === 2) {
        const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) push(makeDateFact(sentence, raw, year, month, day));
      } else {
        const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) push(makeDateFact(sentence, raw, year, month, day));
      }
    }
  }
  return facts;
}

function execAll(re: RegExp, text: string): RegExpExecArray[] {
  re.lastIndex = 0;
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m);
  return out;
}

export function extractFactsFromSentence(sentence: string): Fact[] {
  const facts: Fact[] = [];

  facts.push(...extractDates(sentence));

  for (const m of execAll(PRICE_RE, sentence)) {
    const num = Number(m[1]!.replace(/,/g, ''));
    facts.push({ type: 'price', raw: m[0].trim(), value: num.toFixed(2), sortKey: num, context: null, sentence });
  }

  for (const m of execAll(PERCENT_RE, sentence)) {
    const num = Number(m[1]);
    facts.push({ type: 'percentage', raw: m[0], value: String(num), sortKey: num, context: null, sentence });
  }

  // GPA values only make sense when the sentence talks about GPA/grades.
  if (/\b(gpa|grade point)\b/i.test(sentence)) {
    for (const m of execAll(GPA_RE, sentence)) {
      const num = Number(m[1]);
      if (num <= 4.5) facts.push({ type: 'gpa', raw: m[0], value: num.toFixed(2), sortKey: num, context: null, sentence });
    }
  }

  for (const m of execAll(TIME_RE, sentence)) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) continue;
    const mer = m[3]?.toLowerCase().replace(/\./g, '');
    let h24 = hour;
    if (mer === 'pm' && hour < 12) h24 = hour + 12;
    if (mer === 'am' && hour === 12) h24 = 0;
    facts.push({ type: 'time', raw: m[0].trim(), value: `${pad(h24)}:${pad(minute)}`, sortKey: h24 * 60 + minute, context: null, sentence });
  }

  for (const m of execAll(QUANTITY_RE, sentence)) {
    const num = Number(m[1]!.replace(/,/g, ''));
    facts.push({ type: 'number', raw: m[0], value: String(num), sortKey: num, context: m[2]!.toLowerCase(), sentence });
  }

  for (const m of execAll(EMAIL_RE, sentence)) {
    facts.push({ type: 'email', raw: m[0], value: m[0].toLowerCase(), sortKey: null, context: null, sentence });
  }

  for (const m of execAll(PHONE_RE, sentence)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10) facts.push({ type: 'phone', raw: m[0].trim(), value: digits.slice(-10), sortKey: null, context: null, sentence });
  }

  // Availability, attached to a size/variant when one appears in the same line.
  const avail = AVAILABLE_RE.exec(sentence);
  const unavail = UNAVAILABLE_RE.exec(sentence);
  // "not available"/"sold out" also contain the word "available" — prefer the
  // negative match when both hit.
  const state = unavail ? 'unavailable' : avail ? 'available' : null;
  const stateRaw = unavail ? unavail[0] : avail ? avail[0] : null;
  if (state && stateRaw) {
    const sizeMatch = SIZE_RE.exec(sentence.replace(/\b(sold out|out of stock|in stock)\b/gi, ''));
    facts.push({
      type: 'availability',
      raw: stateRaw,
      value: state,
      sortKey: state === 'available' ? 1 : 0,
      context: sizeMatch ? canonicalSize(sizeMatch[1]!) : null,
      sentence
    });
  }

  return facts;
}

/** Extract facts from a whole section text (line/sentence aware). */
export function extractFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  for (const sentence of splitSentences(text)) {
    facts.push(...extractFactsFromSentence(sentence));
  }
  return facts;
}

/** Human-readable one-line summary of the most relevant extracted values. */
export function summarizeFacts(facts: Fact[]): string {
  const parts: string[] = [];
  const byType = new Map<string, Fact[]>();
  for (const f of facts) {
    const list = byType.get(f.type) ?? [];
    list.push(f);
    byType.set(f.type, list);
  }
  const label: Record<string, string> = {
    date: 'Dates', price: 'Prices', gpa: 'GPA', percentage: 'Percentages',
    availability: 'Availability', time: 'Times', number: 'Quantities', email: 'Email', phone: 'Phone'
  };
  for (const [type, list] of byType) {
    const uniq = [...new Set(list.map((f) => (f.type === 'availability' && f.context ? `${f.context}: ${f.value}` : f.raw)))];
    parts.push(`${label[type] ?? type}: ${uniq.slice(0, 4).join(', ')}`);
  }
  return parts.join(' · ');
}
