/**
 * Meaning comparison.
 *
 * Decides whether a detected change reflects a real change in the
 * underlying information (a moved deadline, a different GPA cutoff, a
 * flipped stock state) or is just harmless rewording/noise.
 *
 * A `SemanticComparisonProvider` interface is defined so a hosted
 * language model can be plugged in later; the default provider is a
 * fully local, deterministic, explainable engine that combines
 * structured value comparison, negation detection, sentence similarity,
 * and category-specific rules. Structured values always override
 * superficial sentence similarity: two nearly identical sentences with
 * different dates are still a meaningful change.
 */
import type { DetectedChange, MeaningResult, ParsedIntent } from '../types.js';
import { extractFacts } from './extract.js';
import { hasNegation, sentenceSimilarity, stemmedSet, containment } from './textUtils.js';

export interface SemanticComparisonInput {
  change: DetectedChange;
  intent: ParsedIntent;
  sectionHeading: string;
}

export interface SemanticComparisonProvider {
  /** Short identifier shown in the UI / About page. */
  readonly name: string;
  readonly description: string;
  compare(input: SemanticComparisonInput): MeaningResult | Promise<MeaningResult>;
}

const FACT_CATEGORIES = new Set([
  'value_increase', 'value_decrease', 'date_moved_earlier', 'date_moved_later',
  'became_available', 'became_unavailable', 'requirement_tightened', 'requirement_relaxed',
  'schedule_changed', 'contact_changed'
]);

/** Words whose presence in an added/removed line suggests substantive info. */
const SUBSTANTIVE_RE = /\b(must|required?|deadline|due|minimum|maximum|eligib\w+|fee|cost|price|gpa|credit|policy|refund|return|cancel\w*|location|venue|address|available|stock|apply|admission|scholarship|award|amount)\b/i;

const AD_NOISE_RE = /\b(sponsored|advertisement|recommended for you|you may also like|related (articles|products|stories)|©|copyright|all rights reserved|sign up for|newsletter|follow us)\b/i;

class LocalComparisonEngine implements SemanticComparisonProvider {
  readonly name = 'local-structured';
  readonly description =
    'Local structured & semantic change analysis: extracted values, negation, sentence similarity, and category rules. No external AI service.';

  compare({ change }: SemanticComparisonInput): MeaningResult {
    const reasonCodes: string[] = [];

    // 1. Structured value changes are meaningful regardless of wording.
    if (FACT_CATEGORIES.has(change.category)) {
      reasonCodes.push('structured_value_changed', `category_${change.category}`);
      return {
        meaningful: true,
        confidence: 0.95,
        reasonCodes,
        explanation: `The underlying ${change.factType ?? 'value'} changed from “${change.oldValue}” to “${change.newValue}”. Wording similarity does not override a changed value.`
      };
    }

    // 2. Location changes detected from context.
    if (change.category === 'location_changed') {
      return {
        meaningful: true,
        confidence: 0.8,
        reasonCodes: ['location_context_changed'],
        explanation: 'The text describing the location changed materially.'
      };
    }

    // 3. Additions/removals: meaningful when they carry substantive info.
    if (change.category === 'addition' || change.category === 'removal') {
      const line = change.category === 'addition' ? change.newEvidence : change.oldEvidence;
      if (AD_NOISE_RE.test(line)) {
        return {
          meaningful: false,
          confidence: 0.85,
          reasonCodes: ['boilerplate_or_promo'],
          explanation: 'The added/removed text looks like promotional or boilerplate content, not substantive information.'
        };
      }
      const substantive = SUBSTANTIVE_RE.test(line) || /\d/.test(line);
      return {
        meaningful: substantive,
        confidence: substantive ? 0.65 : 0.7,
        reasonCodes: substantive ? ['substantive_content_' + change.category] : ['minor_content_' + change.category],
        explanation: substantive
          ? `A ${change.category === 'addition' ? 'new statement was added' : 'statement was removed'} that appears to carry factual information.`
          : `The ${change.category === 'addition' ? 'added' : 'removed'} text does not appear to carry factual information relevant to monitoring.`
      };
    }

    // 4. Paired text changes: same facts on both sides — decide by negation
    //    flips, structured-value equality, and how much meaning-bearing words changed.
    const negFlip = hasNegation(change.oldEvidence) !== hasNegation(change.newEvidence);
    if (negFlip) {
      return {
        meaningful: true,
        confidence: 0.85,
        reasonCodes: ['negation_flip'],
        explanation: 'The statement flipped between affirmative and negative, which changes its meaning.'
      };
    }

    // Structured values override superficial wording distance in both
    // directions: identical extracted facts mean the information did not
    // change even when sentence similarity is low (aggressive rewording).
    const oldFacts = extractFacts(change.oldEvidence);
    const newFacts = extractFacts(change.newEvidence);
    if (oldFacts.length > 0 || newFacts.length > 0) {
      const sig = (f: { type: string; value: string; context: string | null }) =>
        `${f.type}|${f.value}|${(f.context ?? '').toLowerCase()}`;
      const oldSigs = oldFacts.map(sig).sort();
      const newSigs = newFacts.map(sig).sort();
      const sameFacts =
        oldSigs.length === newSigs.length && oldSigs.every((s, i) => s === newSigs[i]);
      if (sameFacts && oldSigs.length > 0) {
        const valueSummary = [...new Set(oldFacts.map((f) => f.value))].join(', ');
        return {
          meaningful: false,
          confidence: 0.9,
          reasonCodes: ['equivalent_rewording', 'same_extracted_values'],
          explanation: `The sentence was reworded but the underlying extracted value(s) (${valueSummary}) did not change. This is the same information stated differently.`
        };
      }
      if (!sameFacts) {
        return {
          meaningful: true,
          confidence: 0.85,
          reasonCodes: ['extracted_values_diverged'],
          explanation: 'Extracted structured values differ between the old and new text, so the underlying information changed even though no single typed fact category was assigned.'
        };
      }
    }

    const similarity = sentenceSimilarity(change.oldEvidence, change.newEvidence);
    const oldSet = stemmedSet(change.oldEvidence);
    const newSet = stemmedSet(change.newEvidence);
    const retained = Math.min(containment(oldSet, newSet), containment(newSet, oldSet));

    if (similarity >= 0.55 || retained >= 0.6) {
      return {
        meaningful: false,
        confidence: Math.min(0.95, 0.55 + similarity * 0.4),
        reasonCodes: ['equivalent_rewording'],
        explanation: 'The sentence was reworded but no extracted value, negation, or substantive content changed. This looks like the same information stated differently.'
      };
    }

    return {
      meaningful: true,
      confidence: 0.55,
      reasonCodes: ['substantial_text_change'],
      explanation: 'The text changed substantially and PagePulse could not confirm the two versions say the same thing.'
    };
  }
}

let provider: SemanticComparisonProvider = new LocalComparisonEngine();

export function getComparisonProvider(): SemanticComparisonProvider {
  return provider;
}

/** Allow a hosted LLM-backed provider to be plugged in later. */
export function setComparisonProvider(p: SemanticComparisonProvider): void {
  provider = p;
}
