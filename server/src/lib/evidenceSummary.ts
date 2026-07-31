/**
 * Evidence comparison helpers — confirmed / unchanged / ignored fact summaries
 * for version comparison without giant raw text diffs.
 */
import type { Fact } from '../types.js';
import { extractFacts } from './extract.js';

function factKey(f: Fact): string {
  return `${f.type}|${f.value}|${(f.context ?? '').toLowerCase()}`;
}

export interface EvidenceFactSummary {
  confirmedChanged: Array<{ type: string; oldValue: string; newValue: string; context: string | null }>;
  unchanged: Array<{ type: string; value: string; context: string | null }>;
  ignoredUnrelated: Array<{ category: string; summary: string; reason: string }>;
}

export function summarizeEvidenceFacts(
  oldText: string,
  newText: string,
  annotatedChanges: Array<{
    category: string;
    oldValue: string;
    newValue: string;
    meaning: { meaningful: boolean; explanation: string };
    intentResult: { matched: boolean; reason: string };
  }>
): EvidenceFactSummary {
  const oldFacts = extractFacts(oldText);
  const newFacts = extractFacts(newText);
  const oldMap = new Map(oldFacts.map((f) => [factKey(f), f]));
  const newMap = new Map(newFacts.map((f) => [factKey(f), f]));

  const unchanged: EvidenceFactSummary['unchanged'] = [];
  for (const [key, fact] of oldMap) {
    if (newMap.has(key)) {
      unchanged.push({ type: fact.type, value: fact.value, context: fact.context });
    }
  }

  const confirmedChanged: EvidenceFactSummary['confirmedChanged'] = [];
  const oldByType = new Map<string, Fact[]>();
  const newByType = new Map<string, Fact[]>();
  for (const f of oldFacts) {
    const list = oldByType.get(f.type) ?? [];
    list.push(f);
    oldByType.set(f.type, list);
  }
  for (const f of newFacts) {
    const list = newByType.get(f.type) ?? [];
    list.push(f);
    newByType.set(f.type, list);
  }
  for (const type of new Set([...oldByType.keys(), ...newByType.keys()])) {
    const o = (oldByType.get(type) ?? []).map((f) => f.value);
    const n = (newByType.get(type) ?? []).map((f) => f.value);
    for (const ov of o) {
      if (!n.includes(ov)) {
        const replacement = n.find((nv) => !o.includes(nv));
        if (replacement) {
          confirmedChanged.push({
            type,
            oldValue: ov,
            newValue: replacement,
            context: (oldByType.get(type) ?? []).find((f) => f.value === ov)?.context ?? null
          });
        }
      }
    }
  }

  const ignoredUnrelated = annotatedChanges
    .filter((c) => !c.meaning.meaningful || !c.intentResult.matched)
    .map((c) => ({
      category: c.category,
      summary: c.oldValue && c.newValue ? `${c.oldValue} → ${c.newValue}` : c.category,
      reason: !c.meaning.meaningful
        ? c.meaning.explanation
        : c.intentResult.reason || 'Did not match the monitoring instruction.'
    }));

  return { confirmedChanged, unchanged, ignoredUnrelated };
}
