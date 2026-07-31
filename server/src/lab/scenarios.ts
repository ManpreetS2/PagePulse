/**
 * Deterministic evaluation scenarios.
 *
 * Each scenario: reset a lab page to baseline, create a monitor with a
 * given intent, apply mutations, run a check, and compare the outcome
 * with the expected result. `kind` describes the mutation from the
 * monitor's point of view: "meaningful" scenarios must alert; "harmless"
 * and "irrelevant" scenarios must stay quiet.
 */
import type { ChangeCategory } from '../types.js';

export interface EvalScenario {
  id: string;
  name: string;
  description: string;
  pageSlug: string;
  intent: string;
  mutations: string[];
  /** meaningful → expect alert; harmless/irrelevant → expect silence. */
  kind: 'meaningful' | 'harmless' | 'irrelevant';
  expected: 'alert' | 'no_alert';
  /** Accepted change categories for a correct alert. */
  expectedCategories?: ChangeCategory[];
  /** Substrings that must appear in the alert's old/new values or evidence. */
  expectedOldValue?: string;
  expectedNewValue?: string;
  /** Substring the tracked section heading must contain after the check. */
  expectedSectionContains: string;
}

export const EVAL_SCENARIOS: EvalScenario[] = [
  // ---- College admissions: GPA intent -------------------------------
  {
    id: 'college-gpa-increase',
    name: 'GPA requirement rises (3.20 → 3.40)',
    description: 'The minimum transfer GPA increases. Must alert with exact old/new values.',
    pageSlug: 'college-admissions',
    intent: 'Alert me if the minimum transfer GPA changes.',
    mutations: ['gpa-increase'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['requirement_tightened', 'value_increase'],
    expectedOldValue: '3.20',
    expectedNewValue: '3.40',
    expectedSectionContains: 'Requirement'
  },
  {
    id: 'college-gpa-decrease',
    name: 'GPA requirement drops (3.20 → 3.00)',
    description: 'The minimum transfer GPA decreases. Must alert.',
    pageSlug: 'college-admissions',
    intent: 'Alert me if the minimum transfer GPA changes.',
    mutations: ['gpa-decrease'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['requirement_relaxed', 'value_decrease'],
    expectedOldValue: '3.20',
    expectedNewValue: '3.00',
    expectedSectionContains: 'Requirement'
  },
  {
    id: 'college-gpa-reword',
    name: 'GPA sentence reworded, same value',
    description: 'Equivalent rewording of the GPA requirement. Must NOT alert.',
    pageSlug: 'college-admissions',
    intent: 'Alert me if the minimum transfer GPA changes.',
    mutations: ['reword-gpa'],
    kind: 'harmless',
    expected: 'no_alert',
    expectedSectionContains: 'Requirement'
  },
  {
    id: 'college-heading-rename',
    name: 'Requirements heading renamed, content equivalent',
    description: 'The section heading changes but the requirement stays 3.20. Must NOT alert, and the section must still be tracked.',
    pageSlug: 'college-admissions',
    intent: 'Alert me if the minimum transfer GPA changes.',
    mutations: ['heading-rename'],
    kind: 'harmless',
    expected: 'no_alert',
    expectedSectionContains: 'Requirement'
  },
  {
    id: 'college-fee-irrelevant',
    name: 'Application fee changes (GPA intent)',
    description: 'The $70 fee rises to $85 — a real change, but unrelated to the GPA instruction. Must NOT alert.',
    pageSlug: 'college-admissions',
    intent: 'Alert me if the minimum transfer GPA changes.',
    mutations: ['fee-change'],
    kind: 'irrelevant',
    expected: 'no_alert',
    expectedSectionContains: 'Requirement'
  },
  {
    id: 'college-units-change',
    name: 'Transferable unit minimum changes (60 → 90)',
    description: 'The unit requirement changes. With a requirements intent, must alert.',
    pageSlug: 'college-admissions',
    intent: 'Tell me if the transfer unit requirements change.',
    mutations: ['units-change'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['requirement_tightened', 'value_increase'],
    expectedOldValue: '60',
    expectedNewValue: '90',
    expectedSectionContains: 'Requirement'
  },
  // ---- College admissions: deadline intent --------------------------
  {
    id: 'college-deadline-later',
    name: 'Fall deadline extended (Sep 30 → Oct 15)',
    description: 'The application deadline moves later. Must alert as a date change.',
    pageSlug: 'college-admissions',
    intent: 'Tell me if the fall application deadline moves.',
    mutations: ['deadline-later'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['date_moved_later'],
    expectedOldValue: 'September 30',
    expectedNewValue: 'October 15',
    expectedSectionContains: 'Deadline'
  },
  {
    id: 'college-deadline-earlier',
    name: 'Fall deadline moves earlier (Sep 30 → Sep 15)',
    description: 'The deadline moves earlier. Must alert.',
    pageSlug: 'college-admissions',
    intent: 'Tell me if the fall application deadline moves.',
    mutations: ['deadline-earlier'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['date_moved_earlier'],
    expectedOldValue: 'September 30',
    expectedNewValue: 'September 15',
    expectedSectionContains: 'Deadline'
  },
  {
    id: 'college-noise-bundle',
    name: 'Navigation, footer, promo, whitespace noise',
    description: 'Nav links move, footer year changes, a promo box is added, whitespace changes. Must NOT alert.',
    pageSlug: 'college-admissions',
    intent: 'Tell me if the fall application deadline moves.',
    mutations: ['nav-shuffle', 'footer-year', 'add-tour-promo', 'whitespace'],
    kind: 'harmless',
    expected: 'no_alert',
    expectedSectionContains: 'Deadline'
  },
  // ---- Product page --------------------------------------------------
  {
    id: 'product-xl-available',
    name: 'XL comes back in stock',
    description: 'Size XL flips from Sold out to In stock. With an XL intent, must alert.',
    pageSlug: 'product-jacket',
    intent: 'Notify me when this jacket becomes available in XL.',
    mutations: ['xl-available'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['became_available'],
    expectedOldValue: 'Sold out',
    expectedNewValue: 'In stock',
    expectedSectionContains: 'Size'
  },
  {
    id: 'product-wrong-size',
    name: 'Medium sells out (XL intent)',
    description: 'Size M flips to Sold out — a real change, but the user asked about XL. Must NOT alert.',
    pageSlug: 'product-jacket',
    intent: 'Notify me when this jacket becomes available in XL.',
    mutations: ['m-soldout'],
    kind: 'irrelevant',
    expected: 'no_alert',
    expectedSectionContains: 'Size'
  },
  {
    id: 'product-price-drop',
    name: 'Price drops ($129.99 → $99.99)',
    description: 'The price falls. With a price intent, must alert.',
    pageSlug: 'product-jacket',
    intent: 'Alert me if the price of this jacket drops.',
    mutations: ['price-drop'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['value_decrease'],
    expectedOldValue: '129.99',
    expectedNewValue: '99.99',
    expectedSectionContains: 'Overview'
  },
  {
    id: 'product-noise',
    name: 'Description reworded + review count bumps',
    description: 'The description is rephrased and the review count rises. With a price intent, must NOT alert.',
    pageSlug: 'product-jacket',
    intent: 'Alert me if the price of this jacket drops.',
    mutations: ['reword-description', 'reviews-bump'],
    kind: 'harmless',
    expected: 'no_alert',
    expectedSectionContains: 'Overview'
  },
  {
    id: 'product-recommendations',
    name: 'Recommended products and ad banner change',
    description: 'Only the “You may also like” items and the sponsored banner change. Must NOT alert.',
    pageSlug: 'product-jacket',
    intent: 'Alert me if the price of this jacket drops.',
    mutations: ['recommended-swap', 'ad-change'],
    kind: 'harmless',
    expected: 'no_alert',
    expectedSectionContains: 'Overview'
  },
  // ---- Scholarship / event / policy ----------------------------------
  {
    id: 'scholarship-deadline-earlier',
    name: 'Scholarship deadline moves earlier (Mar 1 → Feb 15)',
    description: 'The application deadline moves earlier. Must alert.',
    pageSlug: 'scholarship-event',
    intent: 'Tell me if the scholarship application deadline moves.',
    mutations: ['deadline-earlier'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['date_moved_earlier'],
    expectedOldValue: 'March 1',
    expectedNewValue: 'February 15',
    expectedSectionContains: 'Apply'
  },
  {
    id: 'scholarship-award-decrease',
    name: 'Award drops ($5,000 → $4,000)',
    description: 'The award amount decreases. Must alert.',
    pageSlug: 'scholarship-event',
    intent: 'Alert me if the scholarship award amount changes.',
    mutations: ['award-decrease'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['value_decrease'],
    expectedOldValue: '5,000',
    expectedNewValue: '4,000',
    expectedSectionContains: 'Award'
  },
  {
    id: 'scholarship-award-reword',
    name: 'Award sentence reworded, same amount',
    description: 'The award sentence is rephrased but still says $5,000. Must NOT alert.',
    pageSlug: 'scholarship-event',
    intent: 'Alert me if the scholarship award amount changes.',
    mutations: ['reword-award'],
    kind: 'harmless',
    expected: 'no_alert',
    expectedSectionContains: 'Award'
  },
  {
    id: 'scholarship-location-change',
    name: 'Info session venue moves',
    description: 'The event moves from Community Hall to the Riverside Conference Center. Must alert.',
    pageSlug: 'scholarship-event',
    intent: 'Tell me if the info session location changes.',
    mutations: ['location-change'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['location_changed', 'text_change'],
    expectedOldValue: 'Community Hall',
    expectedNewValue: 'Riverside',
    expectedSectionContains: 'Session'
  },
  {
    id: 'scholarship-eligibility-tighten',
    name: 'Eligibility tightens (12 → 15 units)',
    description: 'The enrolled-units eligibility rule rises. Must alert.',
    pageSlug: 'scholarship-event',
    intent: 'Alert me if the eligibility requirements for this scholarship change.',
    mutations: ['eligibility-tighten'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['requirement_tightened', 'value_increase'],
    expectedOldValue: '12',
    expectedNewValue: '15',
    expectedSectionContains: 'Eligibility'
  },
  {
    id: 'scholarship-policy-restrict',
    name: 'Reapplication policy becomes restrictive',
    description: '“Recipients may reapply” flips to “may not reapply” — a negation flip. Must alert.',
    pageSlug: 'scholarship-event',
    intent: 'Alert me if the reapplication policy becomes more restrictive.',
    mutations: ['policy-restrict'],
    kind: 'meaningful',
    expected: 'alert',
    expectedCategories: ['text_change', 'requirement_tightened'],
    expectedOldValue: 'may reapply',
    expectedNewValue: 'may not reapply',
    expectedSectionContains: 'Policy'
  },
  {
    id: 'scholarship-layout-noise',
    name: 'Sections reordered + footer year (deadline intent)',
    description: 'Unrelated sections swap places and the footer year changes. Must NOT alert, and the deadline section must still be tracked.',
    pageSlug: 'scholarship-event',
    intent: 'Tell me if the scholarship application deadline moves.',
    mutations: ['layout-change', 'footer-year'],
    kind: 'harmless',
    expected: 'no_alert',
    expectedSectionContains: 'Apply'
  }
];
