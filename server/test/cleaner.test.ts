import { describe, expect, it } from 'vitest';
import { cleanPage } from '../src/lib/cleaner.js';

const FIXTURE = `<!DOCTYPE html>
<html><head><title>Transfer Admissions | Test U</title>
<style>.x{color:red}</style>
<script>console.log('tracking')</script>
</head>
<body>
<nav><a href="/">Home</a><a href="/apply">Apply</a></nav>
<div class="cookie-banner">We use cookies. Accept?</div>
<div class="ad-slot">Buy our sponsored course now!</div>
<main>
<h1>Transfer Admissions</h1>
<p>Welcome to Test University. We accept transfer students each fall. Our advisors are here to help you plan your path and answer questions about credit, majors, housing, and campus life at Test University.</p>
<h2>Requirements</h2>
<p>A minimum GPA of 3.20 is required for admission consideration.</p>
<ul><li>60 transferable units</li><li>English composition with a C or better</li></ul>
<h2>Deadlines</h2>
<table><tr><th>Term</th><th>Date</th></tr><tr><td>Fall</td><td>September 30, 2026</td></tr></table>
<div style="display:none">Hidden internal note that must not leak.</div>
<div class="related-articles"><h3>Related</h3><p>Ten tips for essays</p></div>
</main>
<footer>© 2025 Test University. All rights reserved.</footer>
</body></html>`;

describe('cleanPage', () => {
  const page = cleanPage(FIXTURE, 'https://testu.example.edu/transfer');

  it('extracts the page title', () => {
    expect(page.title).toBe('Transfer Admissions | Test U');
  });

  it('removes scripts, styles, nav, cookie banners, ads, hidden and related content', () => {
    expect(page.fullText).not.toContain('tracking');
    expect(page.fullText).not.toContain('color:red');
    expect(page.fullText).not.toContain('We use cookies');
    expect(page.fullText).not.toContain('sponsored course');
    expect(page.fullText).not.toContain('Hidden internal note');
    expect(page.fullText).not.toContain('Ten tips for essays');
    expect(page.fullText).not.toContain('All rights reserved');
  });

  it('preserves headings, paragraphs, list items, and table rows', () => {
    const headings = page.sections.map((s) => s.heading);
    expect(headings).toContain('Requirements');
    expect(headings).toContain('Deadlines');
    const requirements = page.sections.find((s) => s.heading === 'Requirements')!;
    expect(requirements.text).toContain('minimum GPA of 3.20');
    expect(requirements.text).toContain('60 transferable units');
    const deadlines = page.sections.find((s) => s.heading === 'Deadlines')!;
    expect(deadlines.text).toContain('Fall | September 30, 2026');
  });

  it('normalizes whitespace', () => {
    expect(page.fullText).not.toMatch(/ {2,}/);
  });

  it('handles pages with no readable content', () => {
    const empty = cleanPage('<html><body><script>x()</script></body></html>', 'https://x.example.com');
    expect(empty.sections).toHaveLength(0);
  });
});
