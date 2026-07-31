/**
 * Section ranking and re-matching.
 *
 * At monitor-creation time, ranks a page's sections against the user's
 * intent. At check time, finds the section that corresponds to the saved
 * baseline even if it moved, was re-headed, or gained/lost neighbors —
 * using heading similarity, intent keywords, text fingerprints, extracted
 * values, and heading-trail context.
 */
import type { Fact, ParsedIntent, Section, SectionMatchResult } from '../types.js';
import { extractFacts } from './extract.js';
import { containment, shingleSimilarity, stemmedSet, sentenceSimilarity } from './textUtils.js';

const FIELD_FACT_TYPES: Record<string, string[]> = {
  deadline: ['date'],
  schedule: ['date', 'time'],
  price: ['price'],
  availability: ['availability'],
  requirement: ['gpa', 'number', 'percentage'],
  eligibility: ['gpa', 'number', 'percentage'],
  contact: ['email', 'phone'],
  policy: ['date', 'percentage', 'price'],
  location: [],
  general: []
};

export interface RankedSection {
  index: number;
  section: Section;
  score: number;
  confidence: number;
  reason: string;
}

/** Rank sections by relevance to the user's intent (monitor creation, step 3). */
export function rankSectionsForIntent(sections: Section[], intent: ParsedIntent): RankedSection[] {
  const intentSet = new Set(intent.keywords.map((k) => k)) as Set<string>;
  const intentStems = stemmedSet(intent.raw);
  const wantedTypes = FIELD_FACT_TYPES[intent.field] ?? [];

  const scored = sections.map((section, index) => {
    const headingStems = stemmedSet(`${section.trail.join(' ')} ${section.heading}`);
    const bodyStems = stemmedSet(section.text);
    const reasons: string[] = [];
    let score = 0;

    const headingOverlap = containment(intentStems, headingStems);
    if (headingOverlap > 0) {
      score += headingOverlap * 0.45;
      reasons.push(`heading matches your instruction (${Math.round(headingOverlap * 100)}%)`);
    }

    const bodyOverlap = containment(intentStems, bodyStems);
    if (bodyOverlap > 0) {
      score += bodyOverlap * 0.3;
      reasons.push(`content mentions ${Math.round(bodyOverlap * 100)}% of your keywords`);
    }

    if (wantedTypes.length > 0) {
      const facts = extractFacts(section.text);
      const hasWanted = facts.some((f) => wantedTypes.includes(f.type));
      if (hasWanted) {
        // The value-type bonus only carries full weight when the section also
        // shares vocabulary with the instruction — otherwise any section with
        // a stray price/date would outrank the truly relevant one.
        const bonus = headingOverlap + bodyOverlap > 0 ? 0.2 : 0.05;
        score += bonus;
        reasons.push(`contains ${intent.field}-type values`);
      }
    }

    if (intent.variant) {
      const v = intent.variant.toLowerCase();
      const tokens = section.text.toLowerCase().split(/[^a-z0-9]+/);
      if (tokens.includes(v)) {
        score += 0.15;
        reasons.push(`mentions "${intent.variant}"`);
      }
    }

    // Mild penalty for very short sections (a heading with no content is a
    // poor monitoring target).
    if (section.text.length < 40) score *= 0.6;

    return {
      index,
      section,
      score,
      confidence: Math.min(1, score),
      reason: reasons.length ? reasons.join('; ') : 'no strong signals for your instruction'
    };
  });

  void intentSet;
  return scored.sort((a, b) => b.score - a.score);
}

export interface BaselineRef {
  heading: string;
  text: string;
  facts: Fact[];
  intent: ParsedIntent;
}

/**
 * Find the section in a freshly fetched page that corresponds to the saved
 * baseline section. Returns confidence and a human-readable reason.
 */
export function matchSectionToBaseline(sections: Section[], baseline: BaselineRef): SectionMatchResult | null {
  if (sections.length === 0) return null;
  const baselineHeadingStems = stemmedSet(baseline.heading);
  const intentStems = stemmedSet(baseline.intent.raw);
  const baselineValues = new Set(baseline.facts.map((f) => `${f.type}:${f.value}`));

  const scored = sections.map((section, index) => {
    let score = 0;
    const reasons: string[] = [];

    // 1. Heading similarity (word overlap + fingerprint for renames).
    const headingSim = Math.max(
      sentenceSimilarity(section.heading, baseline.heading),
      shingleSimilarity(section.heading, baseline.heading)
    );
    score += headingSim * 0.3;
    if (headingSim > 0.6) reasons.push('the heading is nearly identical');
    else if (headingSim > 0.3) reasons.push('the heading is similar');

    // 2. Body text fingerprint (survives moves and moderate edits).
    const textSim = shingleSimilarity(section.text, baseline.text);
    score += textSim * 0.35;
    if (textSim > 0.5) reasons.push('the content closely matches the saved baseline');

    // 3. Intent keywords still present.
    const intentOverlap = containment(intentStems, stemmedSet(`${section.heading} ${section.text}`));
    score += intentOverlap * 0.15;

    // 4. Extracted values in common (a section that still shows the same
    //    GPA/date/price is very likely the same section).
    if (baselineValues.size > 0) {
      const nowValues = new Set(extractFacts(section.text).map((f) => `${f.type}:${f.value}`));
      const common = containment(baselineValues, nowValues);
      score += common * 0.15;
      if (common > 0.5) reasons.push('most of the saved values still appear here');
    }

    // 5. Heading-trail context (ancestor headings similar).
    const trailSim = sentenceSimilarity(section.trail.join(' '), baseline.heading);
    score += Math.min(trailSim, 0.5) * 0.1;

    return { index, section, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const runnerUp = scored[1];

  // Confidence blends the absolute score with the margin over the runner-up.
  const margin = runnerUp ? Math.min(1, (best.score - runnerUp.score) * 2 + 0.5) : 1;
  const confidence = Math.min(1, best.score) * (0.7 + 0.3 * margin);

  return {
    index: best.index,
    section: best.section,
    confidence,
    reason: best.reasons.length ? best.reasons.join('; ') : 'best available match, but signals are weak',
    alternatives: scored.slice(1, 4).map((s) => ({
      index: s.index,
      heading: s.section.heading,
      confidence: Math.min(1, s.score)
    }))
  };
}

/** Below this the monitor is marked uncertain instead of raising alerts. */
export const SECTION_MATCH_MIN_CONFIDENCE = 0.35;
