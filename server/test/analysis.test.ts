/**
 * Unit tests for the analysis stack: section matching, diffing, meaning
 * comparison, intent parsing/matching, and confidence thresholds.
 */
import { describe, expect, it } from 'vitest';
import type { Section } from '../src/types.js';
import { diffSectionText } from '../src/lib/diffEngine.js';
import { getComparisonProvider } from '../src/lib/meaning.js';
import { matchIntent, parseIntent } from '../src/lib/intent.js';
import { extractFacts } from '../src/lib/extract.js';
import { matchSectionToBaseline, rankSectionsForIntent, SECTION_MATCH_MIN_CONFIDENCE } from '../src/lib/sectionMatch.js';
import { sentenceSimilarity, hasNegation } from '../src/lib/textUtils.js';

const section = (heading: string, text: string, level = 2): Section => ({
  heading,
  level,
  trail: [],
  text,
  lines: text.split('\n')
});

const provider = getComparisonProvider();

describe('intent parsing', () => {
  it('interprets a GPA instruction', () => {
    const intent = parseIntent('Alert me if the minimum transfer GPA changes.');
    expect(intent.field).toBe('requirement');
    expect(intent.keywords).toContain('gpa');
  });

  it('interprets an availability instruction with a variant', () => {
    const intent = parseIntent('Notify me when this jacket becomes available in XL.');
    expect(intent.field).toBe('availability');
    expect(intent.variant).toBe('XL');
    expect(intent.trigger).toBe('becomes_available');
  });

  it('interprets deadline and price instructions', () => {
    expect(parseIntent('Tell me if the scholarship deadline moves.').field).toBe('deadline');
    const price = parseIntent('Alert me if the price of this jacket drops.');
    expect(price.field).toBe('price');
    expect(price.trigger).toBe('decrease');
  });

  it('does not read the season "fall" as a decrease trigger', () => {
    const intent = parseIntent('Tell me if the fall application deadline moves.');
    expect(intent.field).toBe('deadline');
    expect(intent.trigger).toBe('any_change');
    expect(parseIntent('Alert me if the price falls below $50.').trigger).toBe('decrease');
  });
});

describe('section ranking and re-matching', () => {
  const sections = [
    section('Campus Life', 'Join over 40 student clubs and organizations on campus.'),
    section('Transfer Admission Requirements', 'Transfer applicants must have a minimum cumulative GPA of 3.20 in transferable coursework.'),
    section('Application Deadlines', 'The fall term application deadline is September 30, 2026.')
  ];

  it('ranks the requirements section first for a GPA intent', () => {
    const intent = parseIntent('Alert me if the minimum transfer GPA changes.');
    const ranked = rankSectionsForIntent(sections, intent);
    expect(ranked[0]!.section.heading).toBe('Transfer Admission Requirements');
    expect(ranked[0]!.confidence).toBeGreaterThan(ranked[1]!.confidence);
  });

  it('re-finds a renamed, moved section from the baseline', () => {
    const intent = parseIntent('Alert me if the minimum transfer GPA changes.');
    const moved = [
      sections[2]!,
      section('Requirements for Transfer Applicants', 'Transfer applicants must have a minimum cumulative GPA of 3.20 in transferable coursework.'),
      sections[0]!
    ];
    const match = matchSectionToBaseline(moved, {
      heading: 'Transfer Admission Requirements',
      text: 'Transfer applicants must have a minimum cumulative GPA of 3.20 in transferable coursework.',
      facts: extractFacts('Transfer applicants must have a minimum cumulative GPA of 3.20 in transferable coursework.'),
      intent
    })!;
    expect(match.section.heading).toBe('Requirements for Transfer Applicants');
    expect(match.confidence).toBeGreaterThan(SECTION_MATCH_MIN_CONFIDENCE);
    expect(match.alternatives.length).toBeGreaterThan(0);
  });

  it('reports low confidence when the section disappeared', () => {
    const intent = parseIntent('Alert me if the minimum transfer GPA changes.');
    const unrelated = [
      section('Parking Permits', 'Semester parking permits cost $45 and are sold online.'),
      section('Dining Hours', 'The dining commons is open 7 AM to 9 PM daily.')
    ];
    const match = matchSectionToBaseline(unrelated, {
      heading: 'Transfer Admission Requirements',
      text: 'Transfer applicants must have a minimum cumulative GPA of 3.20 in transferable coursework.',
      facts: [],
      intent
    })!;
    expect(match.confidence).toBeLessThan(SECTION_MATCH_MIN_CONFIDENCE);
  });
});

describe('heading similarity', () => {
  it('sees renamed headings as similar', () => {
    expect(sentenceSimilarity('Transfer Admission Requirements', 'Requirements for Transfer Applicants')).toBeGreaterThan(0.5);
    expect(sentenceSimilarity('Transfer Admission Requirements', 'Dining Hours')).toBeLessThan(0.2);
  });
});

describe('diff engine + meaning comparison', () => {
  const intent = parseIntent('Alert me if the minimum transfer GPA changes.');

  it('treats equivalent rewording as not meaningful', async () => {
    const changes = diffSectionText(
      'Transfer applicants must have a minimum cumulative GPA of 3.20 in transferable coursework.',
      'Applicants seeking to transfer must hold a cumulative grade point average (GPA) of at least 3.20 in all transferable coursework.'
    );
    expect(changes).toHaveLength(1);
    const meaning = await provider.compare({ change: changes[0]!, intent, sectionHeading: 'Requirements' });
    expect(meaning.meaningful).toBe(false);
    expect(meaning.reasonCodes).toContain('equivalent_rewording');
  });

  it('treats aggressive GPA rewording with the same value as not meaningful', async () => {
    const changes = diffSectionText(
      'Applicants must have a minimum transferable GPA of 3.20.',
      'Transfer applicants are required to maintain at least a 3.20 GPA.'
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.category).toBe('text_change');
    const meaning = await provider.compare({ change: changes[0]!, intent, sectionHeading: 'Minimum GPA' });
    expect(meaning.meaningful).toBe(false);
    expect(meaning.reasonCodes).toContain('same_extracted_values');
    expect(meaning.explanation).toMatch(/3\.20/);
    expect(meaning.explanation).toMatch(/did not change/i);
  });

  it('treats a changed GPA as meaningful even with near-identical wording', async () => {
    const changes = diffSectionText(
      'Transfer applicants must have a minimum cumulative GPA of 3.20.',
      'Transfer applicants must have a minimum cumulative GPA of 3.40.'
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.category).toBe('requirement_tightened');
    expect(changes[0]!.oldValue).toBe('3.20');
    expect(changes[0]!.newValue).toBe('3.40');
    const meaning = await provider.compare({ change: changes[0]!, intent, sectionHeading: 'Requirements' });
    expect(meaning.meaningful).toBe(true);
    expect(meaning.confidence).toBeGreaterThan(0.8);
  });

  it('categorizes date movement direction', () => {
    const later = diffSectionText('Applications close September 30.', 'Applications close October 15.');
    expect(later[0]!.category).toBe('date_moved_later');
    const earlier = diffSectionText('Applications close September 30.', 'Applications close September 15.');
    expect(earlier[0]!.category).toBe('date_moved_earlier');
  });

  it('categorizes availability flips with variant context', () => {
    const changes = diffSectionText('XL | Sold out\nXXL | Sold out', 'XL | In stock\nXXL | Sold out');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.category).toBe('became_available');
    expect(changes[0]!.context).toBe('XL');
  });

  it('detects negation flips as meaningful', async () => {
    const changes = diffSectionText('Recipients may reapply in future award years.', 'Recipients may not reapply in future award years.');
    expect(changes.length).toBeGreaterThan(0);
    const meaning = await provider.compare({
      change: changes[0]!,
      intent: parseIntent('Alert me if the reapplication policy becomes more restrictive.'),
      sectionHeading: 'Reapplication Policy'
    });
    expect(meaning.meaningful).toBe(true);
    expect(meaning.reasonCodes).toContain('negation_flip');
  });

  it('flags promotional additions as not meaningful', async () => {
    const changes = diffSectionText('The deadline is March 1, 2027.', 'The deadline is March 1, 2027.\nSign up for our newsletter for weekly campus stories.');
    const addition = changes.find((c) => c.category === 'addition')!;
    const meaning = await provider.compare({ change: addition, intent, sectionHeading: 'Deadlines' });
    expect(meaning.meaningful).toBe(false);
  });
});

describe('negation detection', () => {
  it('detects negated phrasing', () => {
    expect(hasNegation('Recipients may not reapply.')).toBe(true);
    expect(hasNegation('Pets are no longer allowed.')).toBe(true);
    expect(hasNegation('Recipients may reapply.')).toBe(false);
  });
});

describe('intent matching', () => {
  it('matches a GPA change to a GPA intent', () => {
    const intent = parseIntent('Alert me if the minimum transfer GPA changes.');
    const changes = diffSectionText(
      'Transfer applicants must have a minimum cumulative GPA of 3.20 in transferable coursework.',
      'Transfer applicants must have a minimum cumulative GPA of 3.40 in transferable coursework.'
    );
    const result = matchIntent(changes[0]!, intent, 'Transfer Admission Requirements');
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it('rejects an application-fee change for a GPA intent', () => {
    const intent = parseIntent('Alert me if the minimum transfer GPA changes.');
    const changes = diffSectionText(
      'A non-refundable application fee of $70 is due at submission.',
      'A non-refundable application fee of $85 is due at submission.'
    );
    const result = matchIntent(changes[0]!, intent, 'Fees');
    expect(result.matched).toBe(false);
  });

  it('rejects the wrong variant for an XL intent', () => {
    const intent = parseIntent('Notify me when this jacket becomes available in XL.');
    const changes = diffSectionText('M | In stock', 'M | Sold out');
    const result = matchIntent(changes[0]!, intent, 'Size Availability');
    expect(result.matched).toBe(false);
    expect(result.reason).toContain('"M"');
  });

  it('accepts the requested variant and direction', () => {
    const intent = parseIntent('Notify me when this jacket becomes available in XL.');
    const changes = diffSectionText('XL | Sold out', 'XL | In stock');
    const result = matchIntent(changes[0]!, intent, 'Size Availability');
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('rejects the opposite trigger direction', () => {
    const intent = parseIntent('Notify me when this jacket becomes available in XL.');
    const changes = diffSectionText('XL | In stock', 'XL | Sold out');
    const result = matchIntent(changes[0]!, intent, 'Size Availability');
    expect(result.matched).toBe(false);
  });
});
