import { describe, expect, it } from 'vitest';
import { extractFacts, extractFactsFromSentence } from '../src/lib/extract.js';

const byType = (text: string, type: string) => extractFactsFromSentence(text).filter((f) => f.type === type);

describe('date extraction', () => {
  it('parses long month-name dates', () => {
    const [d] = byType('The application deadline is September 30, 2026.', 'date');
    expect(d?.value).toBe('2026-09-30');
    expect(d?.raw).toContain('September 30');
  });

  it('parses day-first, ISO, and numeric dates', () => {
    expect(byType('Closes 15 October 2026.', 'date')[0]?.value).toBe('2026-10-15');
    expect(byType('Deadline: 2026-03-01.', 'date')[0]?.value).toBe('2026-03-01');
    expect(byType('Due 9/30/2026.', 'date')[0]?.value).toBe('2026-09-30');
  });

  it('keeps dates without a year comparable', () => {
    const [d] = byType('Applications close September 30.', 'date');
    expect(d?.value).toBe('09-30');
    expect(d?.sortKey).not.toBeNull();
  });
});

describe('price / percentage / GPA extraction', () => {
  it('parses currency amounts with separators', () => {
    expect(byType('The award is $5,000 per year.', 'price')[0]?.value).toBe('5000.00');
    expect(byType('Price: $129.99', 'price')[0]?.value).toBe('129.99');
  });

  it('parses percentages', () => {
    expect(byType('Acceptance rate rose to 42.5% this year.', 'percentage')[0]?.value).toBe('42.5');
  });

  it('parses GPA values only in GPA contexts', () => {
    expect(byType('A minimum cumulative GPA of 3.20 is required.', 'gpa')[0]?.value).toBe('3.20');
    // A bare decimal without GPA context is not a GPA.
    expect(byType('Version 3.20 was released.', 'gpa')).toHaveLength(0);
  });
});

describe('availability extraction', () => {
  it('detects stock states with size context', () => {
    const [f] = byType('XL | Sold out', 'availability');
    expect(f?.value).toBe('unavailable');
    expect(f?.context).toBe('XL');
  });

  it('prefers the negative phrase when both appear', () => {
    const [f] = byType('This item is currently not available.', 'availability');
    expect(f?.value).toBe('unavailable');
  });

  it('detects in-stock states', () => {
    const [f] = byType('M | In stock', 'availability');
    expect(f?.value).toBe('available');
    expect(f?.context).toBe('M');
  });
});

describe('quantities, contact info, and section-level extraction', () => {
  it('parses unit-bearing quantities', () => {
    const [f] = byType('A minimum of 60 quarter units is required.', 'number');
    expect(f?.value).toBe('60');
  });

  it('parses emails and phone numbers', () => {
    expect(byType('Email admissions@school.edu for details.', 'email')[0]?.value).toBe('admissions@school.edu');
    expect(byType('Call (555) 210-4400 to schedule.', 'phone')).toHaveLength(1);
  });

  it('extracts multiple facts from multi-line sections', () => {
    const facts = extractFacts('Tuition\nThe fee is $70.\nDeadline is March 1, 2027.');
    const types = facts.map((f) => f.type);
    expect(types).toContain('price');
    expect(types).toContain('date');
  });
});
