/**
 * Difference engine.
 *
 * Compares the old and new versions of the monitored section at the
 * line/sentence level, pairs edited lines by similarity, and produces
 * categorized changes (date moved, value increased, became available,
 * requirement tightened, …) with exact evidence spans — not one giant
 * raw text diff.
 */
import type { ChangeCategory, DetectedChange, Fact } from '../types.js';
import { extractFactsFromSentence } from './extract.js';
import { normalize, sentenceSimilarity, splitSentences } from './textUtils.js';

const REQUIREMENT_CONTEXT_RE = /\b(minimum|at least|required|must|no more than|maximum|need(?:ed)?|cutoff|threshold)\b/i;
const LOCATION_CONTEXT_RE = /\b(located|location|venue|held (at|in)|takes? place|moved to|address|room|hall|building|campus|center|centre|auditorium)\b/i;

/** Pair up old/new lines: exact matches, then best-similarity pairs, then leftovers. */
function pairLines(oldLines: string[], newLines: string[]): {
  pairs: Array<{ oldLine: string; newLine: string; similarity: number }>;
  removed: string[];
  added: string[];
} {
  const oldNorm = oldLines.map(normalize);
  const newNorm = newLines.map(normalize);
  const usedNew = new Set<number>();
  const usedOld = new Set<number>();

  // Exact (normalized) matches are unchanged content — drop them.
  for (let i = 0; i < oldLines.length; i++) {
    const j = newNorm.findIndex((n, idx) => !usedNew.has(idx) && n === oldNorm[i]);
    if (j !== -1) {
      usedOld.add(i);
      usedNew.add(j);
    }
  }

  // Pair remaining lines greedily by similarity.
  const pairs: Array<{ oldLine: string; newLine: string; similarity: number }> = [];

  // Semantic pre-pass: rows that carry an availability fact for the SAME
  // variant ("M | In stock" → "M | Sold out") are the same row even when
  // token similarity is tiny (single-letter sizes carry no token weight).
  const availContext = (line: string): string | null => {
    const fact = extractFactsFromSentence(line).find((f) => f.type === 'availability');
    return fact?.context ?? null;
  };
  for (let i = 0; i < oldLines.length; i++) {
    if (usedOld.has(i)) continue;
    const ctx = availContext(oldLines[i]!);
    if (!ctx) continue;
    for (let j = 0; j < newLines.length; j++) {
      if (usedNew.has(j)) continue;
      if (availContext(newLines[j]!) === ctx) {
        usedOld.add(i);
        usedNew.add(j);
        pairs.push({ oldLine: oldLines[i]!, newLine: newLines[j]!, similarity: sentenceSimilarity(oldLines[i]!, newLines[j]!) });
        break;
      }
    }
  }

  const candidates: Array<{ i: number; j: number; sim: number }> = [];
  for (let i = 0; i < oldLines.length; i++) {
    if (usedOld.has(i)) continue;
    for (let j = 0; j < newLines.length; j++) {
      if (usedNew.has(j)) continue;
      const sim = sentenceSimilarity(oldLines[i]!, newLines[j]!);
      // Sentences describing the same location/venue often share few tokens
      // after the venue changes; pair them on shared context instead.
      const bothLocation = LOCATION_CONTEXT_RE.test(oldLines[i]!) && LOCATION_CONTEXT_RE.test(newLines[j]!);
      if (sim >= 0.3 || (bothLocation && sim >= 0.15)) candidates.push({ i, j, sim });
    }
  }
  candidates.sort((a, b) => b.sim - a.sim);
  for (const c of candidates) {
    if (usedOld.has(c.i) || usedNew.has(c.j)) continue;
    usedOld.add(c.i);
    usedNew.add(c.j);
    pairs.push({ oldLine: oldLines[c.i]!, newLine: newLines[c.j]!, similarity: c.sim });
  }

  const removed = oldLines.filter((_, i) => !usedOld.has(i));
  const added = newLines.filter((_, j) => !usedNew.has(j));
  return { pairs, removed, added };
}

function factKey(f: Fact): string {
  return `${f.type}:${f.context ?? ''}`;
}

/** Categorize a fact-value change, considering sentence context. */
function categorizeFactChange(oldFact: Fact, newFact: Fact, sentence: string): ChangeCategory {
  if (oldFact.type === 'availability') {
    return newFact.value === 'available' ? 'became_available' : 'became_unavailable';
  }
  if (oldFact.type === 'date') {
    if (oldFact.sortKey !== null && newFact.sortKey !== null) {
      return newFact.sortKey < oldFact.sortKey ? 'date_moved_earlier' : 'date_moved_later';
    }
    return 'schedule_changed';
  }
  if (oldFact.type === 'time') return 'schedule_changed';
  if (oldFact.type === 'email' || oldFact.type === 'phone') return 'contact_changed';
  if (oldFact.sortKey !== null && newFact.sortKey !== null) {
    const increased = newFact.sortKey > oldFact.sortKey;
    // A change to a stated minimum/required value is a requirement change.
    if (REQUIREMENT_CONTEXT_RE.test(sentence) && (oldFact.type === 'gpa' || oldFact.type === 'number' || oldFact.type === 'percentage')) {
      const isMaximumStyle = /\b(no more than|maximum|at most|up to)\b/i.test(sentence);
      if (isMaximumStyle) return increased ? 'requirement_relaxed' : 'requirement_tightened';
      return increased ? 'requirement_tightened' : 'requirement_relaxed';
    }
    return increased ? 'value_increase' : 'value_decrease';
  }
  return 'text_change';
}

/** Compare paired lines fact-by-fact; fall back to a generic text change. */
function diffPair(oldLine: string, newLine: string): DetectedChange[] {
  const oldFacts = extractFactsFromSentence(oldLine);
  const newFacts = extractFactsFromSentence(newLine);
  const changes: DetectedChange[] = [];

  const oldByKey = new Map<string, Fact[]>();
  for (const f of oldFacts) {
    const list = oldByKey.get(factKey(f)) ?? [];
    list.push(f);
    oldByKey.set(factKey(f), list);
  }
  const newByKey = new Map<string, Fact[]>();
  for (const f of newFacts) {
    const list = newByKey.get(factKey(f)) ?? [];
    list.push(f);
    newByKey.set(factKey(f), list);
  }

  for (const [key, oldList] of oldByKey) {
    const newList = newByKey.get(key);
    if (!newList) continue;
    const oldValues = oldList.map((f) => f.value).join(',');
    const newValues = newList.map((f) => f.value).join(',');
    if (oldValues === newValues) continue;
    // Compare the first differing value pair for evidence.
    const oldFact = oldList.find((f) => !newList.some((n) => n.value === f.value)) ?? oldList[0]!;
    const newFact = newList.find((f) => !oldList.some((o) => o.value === f.value)) ?? newList[0]!;
    changes.push({
      category: categorizeFactChange(oldFact, newFact, `${oldLine} ${newLine}`),
      oldValue: oldFact.type === 'availability' && oldFact.context ? `${oldFact.context}: ${oldFact.raw}` : oldFact.raw,
      newValue: newFact.type === 'availability' && newFact.context ? `${newFact.context}: ${newFact.raw}` : newFact.raw,
      oldEvidence: oldLine,
      newEvidence: newLine,
      factType: oldFact.type,
      context: oldFact.context ?? newFact.context
    });
  }

  // Location context: when both sides describe a venue/place and no typed
  // fact changed, a substantive wording change is a location change (checked
  // before the bare-number fallback so "Room 204 → 800 River Road" is not
  // misread as a numeric increase).
  if (
    changes.length === 0 &&
    LOCATION_CONTEXT_RE.test(oldLine) &&
    LOCATION_CONTEXT_RE.test(newLine) &&
    normalize(oldLine) !== normalize(newLine) &&
    sentenceSimilarity(oldLine, newLine) < 0.75
  ) {
    changes.push({
      category: 'location_changed',
      oldValue: oldLine.length > 120 ? oldLine.slice(0, 117) + '…' : oldLine,
      newValue: newLine.length > 120 ? newLine.slice(0, 117) + '…' : newLine,
      oldEvidence: oldLine,
      newEvidence: newLine,
      factType: null,
      context: null
    });
  }

  // Fallback: bare numeric tokens that typed extraction missed
  // (e.g. "60 transferable quarter units" → "90 transferable quarter units").
  if (changes.length === 0) {
    const numRe = /\d{1,3}(?:,\d{3})*(?:\.\d+)?/g;
    const oldNums: string[] = oldLine.match(numRe) ?? [];
    const newNums: string[] = newLine.match(numRe) ?? [];
    if (oldNums.join('|') !== newNums.join('|')) {
      const oldOnly = oldNums.filter((n) => !newNums.includes(n));
      const newOnly = newNums.filter((n) => !oldNums.includes(n));
      const oldRaw = oldOnly[0] ?? oldNums.join(', ');
      const newRaw = newOnly[0] ?? newNums.join(', ');
      const oldVal = Number((oldOnly[0] ?? '').replace(/,/g, ''));
      const newVal = Number((newOnly[0] ?? '').replace(/,/g, ''));
      let category: ChangeCategory = 'text_change';
      if (Number.isFinite(oldVal) && Number.isFinite(newVal) && oldOnly.length && newOnly.length) {
        if (REQUIREMENT_CONTEXT_RE.test(`${oldLine} ${newLine}`)) {
          const isMaximumStyle = /\b(no more than|maximum|at most|up to)\b/i.test(`${oldLine} ${newLine}`);
          const increased = newVal > oldVal;
          category = isMaximumStyle
            ? increased ? 'requirement_relaxed' : 'requirement_tightened'
            : increased ? 'requirement_tightened' : 'requirement_relaxed';
        } else {
          category = newVal > oldVal ? 'value_increase' : 'value_decrease';
        }
      }
      changes.push({
        category,
        oldValue: oldRaw,
        newValue: newRaw,
        oldEvidence: oldLine,
        newEvidence: newLine,
        factType: 'number',
        context: null
      });
    }
  }

  // Generic text change whenever the normalized text differs. (Do not gate
  // this on token similarity: "may reapply" vs "may not reapply" can score
  // 1.0 on content-token similarity while flipping the meaning.)
  if (changes.length === 0 && normalize(oldLine) !== normalize(newLine)) {
    const category: ChangeCategory = LOCATION_CONTEXT_RE.test(oldLine) && LOCATION_CONTEXT_RE.test(newLine) ? 'location_changed' : 'text_change';
    changes.push({
      category,
      oldValue: oldLine.length > 120 ? oldLine.slice(0, 117) + '…' : oldLine,
      newValue: newLine.length > 120 ? newLine.slice(0, 117) + '…' : newLine,
      oldEvidence: oldLine,
      newEvidence: newLine,
      factType: null,
      context: null
    });
  }
  return changes;
}

/**
 * Diff two section texts. Works on lines first (preserves list/table rows),
 * splitting long paragraphs into sentences.
 */
export function diffSectionText(oldText: string, newText: string): DetectedChange[] {
  const oldLines = splitSentences(oldText);
  const newLines = splitSentences(newText);
  const { pairs, removed, added } = pairLines(oldLines, newLines);

  const changes: DetectedChange[] = [];
  for (const pair of pairs) {
    changes.push(...diffPair(pair.oldLine, pair.newLine));
  }
  for (const line of removed) {
    changes.push({
      category: 'removal',
      oldValue: line.length > 120 ? line.slice(0, 117) + '…' : line,
      newValue: '',
      oldEvidence: line,
      newEvidence: '',
      factType: null,
      context: null
    });
  }
  for (const line of added) {
    changes.push({
      category: 'addition',
      oldValue: '',
      newValue: line.length > 120 ? line.slice(0, 117) + '…' : line,
      oldEvidence: '',
      newEvidence: line,
      factType: null,
      context: null
    });
  }
  return changes;
}
