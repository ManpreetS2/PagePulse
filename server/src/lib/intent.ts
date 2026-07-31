/**
 * Intent interpretation and matching.
 *
 * Turns a natural-language monitoring instruction into a structured,
 * user-reviewable interpretation (subject, field, variant, trigger,
 * keywords), and scores detected changes against it.
 */
import type { ChangeCategory, DetectedChange, IntentMatchResult, ParsedIntent, TargetType } from '../types.js';
import { canonicalSize } from './extract.js';
import { containment, contentTokens, stem, stemmedSet } from './textUtils.js';

const FIELD_RULES: Array<{ field: TargetType; re: RegExp }> = [
  { field: 'deadline', re: /\b(deadline|due date|due by|closes?|closing date|apply by|application (date|deadline|window)|last day|cutoff)\b/i },
  { field: 'availability', re: /\b(available|availability|in stock|stock|restock|sold out|back in|inventory|size)\b/i },
  { field: 'price', re: /\b(price|prices|pricing|cost|costs|tuition|cheaper|discount|drops? below|award amount|amount|award|stipend|salary|\$)\b/i },
  { field: 'eligibility', re: /\b(eligib\w+|qualif\w+|who can apply)\b/i },
  { field: 'requirement', re: /\b(requirements?|required|minimum|gpa|test scores?|prerequisites?|credits|units|criteria)\b/i },
  { field: 'location', re: /\b(location|venue|address|where|campus|room|building|moved to|relocat\w+)\b/i },
  { field: 'schedule', re: /\b(schedule|time|hours|reschedul\w+|postpon\w+|date of the|event date|start(s| date| time)?)\b/i },
  { field: 'contact', re: /\b(contact|email address|phone|phone number)\b/i },
  { field: 'policy', re: /\b(policy|policies|terms|rules?|restrict\w+|refund|return window)\b/i }
];

const CATEGORY_FOR_FIELD: Record<TargetType, ChangeCategory[]> = {
  deadline: ['date_moved_earlier', 'date_moved_later', 'schedule_changed'],
  availability: ['became_available', 'became_unavailable'],
  price: ['value_increase', 'value_decrease'],
  requirement: ['requirement_tightened', 'requirement_relaxed', 'value_increase', 'value_decrease'],
  eligibility: ['requirement_tightened', 'requirement_relaxed', 'value_increase', 'value_decrease'],
  schedule: ['schedule_changed', 'date_moved_earlier', 'date_moved_later'],
  location: ['location_changed'],
  contact: ['contact_changed'],
  policy: ['requirement_tightened', 'requirement_relaxed', 'text_change', 'addition', 'removal'],
  general: []
};

const SIZE_IN_INTENT_RE = /\b(size\s+)?(xxs|xs|small|medium|large|extra small|extra large|xl|xxl|2xl|3xl)\b/i;

export function parseIntent(raw: string): ParsedIntent {
  const text = raw.trim();

  let field: TargetType = 'general';
  for (const rule of FIELD_RULES) {
    if (rule.re.test(text)) {
      field = rule.field;
      break;
    }
  }

  // Variant: an explicit size mention ("in XL", "size medium") or a quoted value.
  let variant: string | null = null;
  const quoted = /["“']([^"”']{1,40})["”']/.exec(text);
  const size = SIZE_IN_INTENT_RE.exec(text);
  if (size) variant = canonicalSize(size[2]!);
  else if (quoted) variant = quoted[1]!.trim();

  let trigger: ParsedIntent['trigger'] = 'any_change';
  if (/\b(becomes? available|back in stock|restock\w*|is available again|in stock)\b/i.test(text)) trigger = 'becomes_available';
  else if (/\b(sold out|out of stock|becomes? unavailable|no longer available|discontinued)\b/i.test(text)) trigger = 'becomes_unavailable';
  else if (/\b(increase|raise[sd]?|goes? up|rises?|higher|more expensive|above|exceeds?)\b/i.test(text)) trigger = 'increase';
  else if (/\b(decreases?|drops?|goes? down|falls|fall below|lower|cheaper|below|discount)\b/i.test(text)) trigger = 'decrease';
  else if (/\b(moves? (up|earlier)|earlier|sooner)\b/i.test(text)) trigger = 'moves_earlier';
  else if (/\b(moves? (back|later)|later|extended|postponed)\b/i.test(text)) trigger = 'moves_later';

  const keywords = [...new Set(contentTokens(text))].filter((k) => !SIZE_IN_INTENT_RE.test(k) || k.length > 3);

  // Subject: the phrase after "if/when/whether", stripped of trigger words —
  // falls back to the keyword list.
  const clause = /\b(?:if|when|whether)\s+(?:the\s+|this\s+|a\s+)?(.{3,80}?)(?:\s+(?:changes?|moves?|increases?|decreases?|becomes?|drops?|is|goes)\b|$)/i.exec(text);
  const subject = clause ? clause[1]!.trim() : keywords.slice(0, 5).join(' ');

  return { subject, field, variant, trigger, keywords, raw: text };
}

const TYPE_MATCHES_FIELD: Record<TargetType, string[]> = {
  deadline: ['date', 'time'],
  schedule: ['date', 'time'],
  price: ['price'],
  availability: ['availability'],
  requirement: ['gpa', 'number', 'percentage', 'date'],
  eligibility: ['gpa', 'number', 'percentage'],
  location: [],
  contact: ['email', 'phone'],
  policy: ['number', 'percentage', 'date', 'price'],
  general: []
};

/** Does the evidence text mention the intent's variant as a whole token? */
export function evidenceMentionsVariant(evidence: string, variant: string): boolean {
  const canon = canonicalSize(variant).toLowerCase();
  const tokens = evidence.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes(canon.toLowerCase())) return true;
  // Also allow long-form sizes: "extra large" for XL, etc.
  const longForm: Record<string, string> = { xs: 'extra small', s: 'small', m: 'medium', l: 'large', xl: 'extra large' };
  const lf = longForm[canon.toLowerCase()];
  return lf ? evidence.toLowerCase().includes(lf) : false;
}

/**
 * Score a detected change against the user's intent.
 * Combines category/field correspondence, variant matching, trigger
 * direction, and keyword overlap with the evidence.
 */
export function matchIntent(change: DetectedChange, intent: ParsedIntent, sectionHeading: string): IntentMatchResult {
  const evidence = `${change.oldEvidence} ${change.newEvidence}`;
  const reasons: string[] = [];
  let score = 0;

  // 1. Variant gate: when the user asked about a specific variant (e.g. XL),
  //    the change must concern that variant.
  if (intent.variant) {
    const changeVariant = change.context ? canonicalSize(change.context) : null;
    const wanted = canonicalSize(intent.variant);
    if (changeVariant && changeVariant === wanted) {
      score += 0.35;
      reasons.push(`concerns the requested variant "${wanted}"`);
    } else if (changeVariant && changeVariant !== wanted) {
      return { matched: false, confidence: 0.9, reason: `The change concerns "${changeVariant}", not the requested "${wanted}".` };
    } else if (evidenceMentionsVariant(evidence, wanted)) {
      score += 0.25;
      reasons.push(`evidence mentions "${wanted}"`);
    } else if (change.factType === 'availability' || intent.field === 'availability') {
      return { matched: false, confidence: 0.8, reason: `The change does not mention the requested variant "${wanted}".` };
    }
  }

  // 2. Category / field correspondence.
  const expectedCategories = CATEGORY_FOR_FIELD[intent.field];
  const expectedTypes = TYPE_MATCHES_FIELD[intent.field];
  if (expectedCategories.includes(change.category)) {
    score += 0.35;
    reasons.push(`change type (${change.category.replace(/_/g, ' ')}) matches what you asked to watch`);
  } else if (change.factType && expectedTypes.includes(change.factType)) {
    score += 0.2;
    reasons.push(`the changed value is a ${change.factType}, which matches your instruction`);
  } else if (intent.field === 'general') {
    score += 0.15;
  }

  // 3. Trigger direction.
  const directionOk = checkTrigger(intent.trigger, change.category);
  if (directionOk === 'match') {
    score += 0.2;
    reasons.push('the direction of the change matches your trigger');
  } else if (directionOk === 'mismatch') {
    return {
      matched: false,
      confidence: 0.85,
      reason: `You asked to be alerted when it ${describeTrigger(intent.trigger)}, but this change went the other way (${change.category.replace(/_/g, ' ')}).`
    };
  }

  // 4. Keyword overlap between the intent and the evidence + heading.
  const intentSet = new Set(intent.keywords.map(stem));
  const evidenceSet = stemmedSet(`${evidence} ${sectionHeading}`);
  const overlap = containment(intentSet, evidenceSet);
  score += overlap * 0.3;
  if (overlap >= 0.34) reasons.push(`the evidence overlaps your instruction's keywords (${Math.round(overlap * 100)}%)`);

  const confidence = Math.min(1, score);
  const matched = confidence >= 0.4;
  return {
    matched,
    confidence,
    reason: matched
      ? `Matched because ${reasons.join('; ')}.`
      : `This change does not appear related to your instruction (${intent.raw}).`
  };
}

function checkTrigger(trigger: ParsedIntent['trigger'], category: ChangeCategory): 'match' | 'mismatch' | 'neutral' {
  switch (trigger) {
    case 'any_change':
      return 'neutral';
    case 'becomes_available':
      if (category === 'became_available') return 'match';
      if (category === 'became_unavailable') return 'mismatch';
      return 'neutral';
    case 'becomes_unavailable':
      if (category === 'became_unavailable') return 'match';
      if (category === 'became_available') return 'mismatch';
      return 'neutral';
    case 'increase':
      if (category === 'value_increase' || category === 'requirement_tightened') return 'match';
      if (category === 'value_decrease' || category === 'requirement_relaxed') return 'mismatch';
      return 'neutral';
    case 'decrease':
      if (category === 'value_decrease' || category === 'requirement_relaxed') return 'match';
      if (category === 'value_increase' || category === 'requirement_tightened') return 'mismatch';
      return 'neutral';
    case 'moves_earlier':
      if (category === 'date_moved_earlier') return 'match';
      if (category === 'date_moved_later') return 'mismatch';
      return 'neutral';
    case 'moves_later':
      if (category === 'date_moved_later') return 'match';
      if (category === 'date_moved_earlier') return 'mismatch';
      return 'neutral';
  }
}

function describeTrigger(trigger: ParsedIntent['trigger']): string {
  switch (trigger) {
    case 'becomes_available': return 'becomes available';
    case 'becomes_unavailable': return 'becomes unavailable';
    case 'increase': return 'increases';
    case 'decrease': return 'decreases';
    case 'moves_earlier': return 'moves earlier';
    case 'moves_later': return 'moves later';
    default: return 'changes';
  }
}
