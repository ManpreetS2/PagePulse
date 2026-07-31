/**
 * Evaluation Lab controlled test pages.
 *
 * Three deterministic, locally served webpages with named mutations.
 * Each mutation is either "meaningful" (a real factual change PagePulse
 * should catch) or "harmless" (noise PagePulse should ignore). Page state
 * (the set of active mutations) is persisted in SQLite so the lab
 * survives restarts.
 */
import { getDb } from '../db.js';

export type MutationKind = 'meaningful' | 'harmless';

export interface LabMutation {
  id: string;
  label: string;
  kind: MutationKind;
  description: string;
}

export interface LabPage {
  slug: string;
  name: string;
  description: string;
  suggestedIntent: string;
  mutations: LabMutation[];
  render(active: Set<string>): string;
}

function pageShell(title: string, body: string, footerYear: string, navExtra = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>body{font-family:Georgia,serif;max-width:52rem;margin:0 auto;padding:1rem}nav a{margin-right:1rem}footer{margin-top:3rem;color:#666;font-size:.9rem}</style>
</head>
<body>
<nav aria-label="Main">${navExtra}<a href="/lab-pages">Home</a> <a href="#about">About</a> <a href="#contact">Contact</a></nav>
<main>
${body}
</main>
<footer id="contact">© ${footerYear} PagePulse Evaluation Lab — controlled test page. All content is fictional.</footer>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/* Page 1: College transfer admissions                                  */
/* ------------------------------------------------------------------ */

const collegePage: LabPage = {
  slug: 'college-admissions',
  name: 'Westfield State University — Transfer Admissions',
  description: 'A fictional university admissions page with GPA requirements, unit minimums, deadlines, and fees.',
  suggestedIntent: 'Alert me if the minimum transfer GPA changes.',
  mutations: [
    { id: 'gpa-increase', label: 'Raise minimum GPA to 3.40', kind: 'meaningful', description: 'Minimum transfer GPA changes from 3.20 to 3.40.' },
    { id: 'gpa-decrease', label: 'Lower minimum GPA to 3.00', kind: 'meaningful', description: 'Minimum transfer GPA changes from 3.20 to 3.00.' },
    { id: 'deadline-later', label: 'Move fall deadline to October 15', kind: 'meaningful', description: 'Fall application deadline moves from September 30 to October 15, 2026.' },
    { id: 'deadline-earlier', label: 'Move fall deadline to September 15', kind: 'meaningful', description: 'Fall application deadline moves earlier, to September 15, 2026.' },
    { id: 'fee-change', label: 'Raise application fee to $85', kind: 'meaningful', description: 'Application fee changes from $70 to $85 (meaningful, but unrelated to a GPA intent).' },
    { id: 'units-change', label: 'Require 90 quarter units', kind: 'meaningful', description: 'Transferable unit minimum changes from 60 to 90 quarter units.' },
    { id: 'reword-gpa', label: 'Reword the GPA sentence (same value)', kind: 'harmless', description: 'The GPA requirement is reworded but still says 3.20.' },
    { id: 'heading-rename', label: 'Rename the requirements heading', kind: 'harmless', description: '“Transfer Admission Requirements” becomes “Requirements for Transfer Applicants”.' },
    { id: 'footer-year', label: 'Bump the footer copyright year', kind: 'harmless', description: 'Footer year changes from 2025 to 2026.' },
    { id: 'nav-shuffle', label: 'Reorder navigation links', kind: 'harmless', description: 'A “Campus Tours” link is added to the navigation bar.' },
    { id: 'add-tour-promo', label: 'Add a campus-tour promo box', kind: 'harmless', description: 'A promotional “book a campus tour” blurb is added elsewhere on the page.' },
    { id: 'whitespace', label: 'Change whitespace and layout', kind: 'harmless', description: 'Extra whitespace and wrapper divs are introduced without changing text.' }
  ],
  render(active: Set<string>): string {
    const gpa = active.has('gpa-increase') ? '3.40' : active.has('gpa-decrease') ? '3.00' : '3.20';
    const deadline = active.has('deadline-later')
      ? 'October 15, 2026'
      : active.has('deadline-earlier')
        ? 'September 15, 2026'
        : 'September 30, 2026';
    const fee = active.has('fee-change') ? '$85' : '$70';
    const units = active.has('units-change') ? '90' : '60';
    const gpaSentence = active.has('reword-gpa')
      ? `Applicants seeking to transfer must hold a cumulative grade point average (GPA) of at least ${gpa} in all transferable coursework.`
      : `Transfer applicants must have a minimum cumulative GPA of ${gpa} in transferable coursework.`;
    const reqHeading = active.has('heading-rename') ? 'Requirements for Transfer Applicants' : 'Transfer Admission Requirements';
    const footerYear = active.has('footer-year') ? '2026' : '2025';
    const navExtra = active.has('nav-shuffle') ? '<a href="#tours">Campus Tours</a> ' : '';
    const ws = active.has('whitespace') ? '\n\n<div><div>' : '';
    const wsEnd = active.has('whitespace') ? '</div></div>\n\n' : '';
    const promo = active.has('add-tour-promo')
      ? '<section id="tours"><h2>Visit Westfield State</h2><p>Book a guided campus tour and experience student life firsthand. Tours run Monday through Saturday.</p></section>'
      : '';

    const body = `
<h1>Transfer Admissions</h1>
<p>Westfield State University welcomes transfer students from community colleges and four-year institutions. Review the requirements and deadlines below before applying.</p>
${ws}
<section>
<h2>${reqHeading}</h2>
<p>${gpaSentence}</p>
<ul>
<li>A minimum of ${units} transferable quarter units completed before the term of entry.</li>
<li>Completion of college-level English composition and mathematics with a grade of C or better.</li>
<li>Official transcripts from every college or university attended.</li>
</ul>
</section>
${wsEnd}
<section>
<h2>Application Deadlines</h2>
<p>The fall term application deadline is ${deadline}. Applications received after the deadline are considered on a space-available basis.</p>
<table>
<tr><th>Term</th><th>Deadline</th></tr>
<tr><td>Fall 2026</td><td>${deadline}</td></tr>
<tr><td>Spring 2027</td><td>January 20, 2027</td></tr>
</table>
</section>
<section>
<h2>Fees</h2>
<p>A non-refundable application fee of ${fee} is required at the time of submission. Fee waivers are available for eligible students.</p>
</section>
${promo}
<section id="about">
<h2>Advising and Contact</h2>
<p>Questions about transfer admission can be sent to admissions@westfield.example.edu or call (555) 210-4400.</p>
</section>`;
    return pageShell('Transfer Admissions | Westfield State University', body, footerYear, navExtra);
  }
};

/* ------------------------------------------------------------------ */
/* Page 2: Product availability and pricing                             */
/* ------------------------------------------------------------------ */

const productPage: LabPage = {
  slug: 'product-jacket',
  name: 'Alpine Trail Jacket — Product Page',
  description: 'A fictional product page with a price, a size-availability table, reviews, and recommendations.',
  suggestedIntent: 'Notify me when this jacket becomes available in XL.',
  mutations: [
    { id: 'xl-available', label: 'XL comes back in stock', kind: 'meaningful', description: 'Size XL changes from Sold out to In stock.' },
    { id: 'price-drop', label: 'Drop price to $99.99', kind: 'meaningful', description: 'Price changes from $129.99 to $99.99.' },
    { id: 'price-increase', label: 'Raise price to $149.99', kind: 'meaningful', description: 'Price changes from $129.99 to $149.99.' },
    { id: 'm-soldout', label: 'Medium sells out', kind: 'meaningful', description: 'Size M changes from In stock to Sold out (meaningful, but irrelevant to an XL intent).' },
    { id: 'reword-description', label: 'Reword the product description', kind: 'harmless', description: 'The description is rephrased with the same meaning.' },
    { id: 'reviews-bump', label: 'Increase the review count', kind: 'harmless', description: 'Review count changes from 128 to 131.' },
    { id: 'recommended-swap', label: 'Swap the recommended products', kind: 'harmless', description: 'The “You may also like” items change.' },
    { id: 'ad-change', label: 'Change the banner ad text', kind: 'harmless', description: 'Sponsored banner content changes.' }
  ],
  render(active: Set<string>): string {
    const price = active.has('price-drop') ? '$99.99' : active.has('price-increase') ? '$149.99' : '$129.99';
    const xl = active.has('xl-available') ? 'In stock' : 'Sold out';
    const m = active.has('m-soldout') ? 'Sold out' : 'In stock';
    const description = active.has('reword-description')
      ? 'Built for wet, windy ridgelines, the Alpine Trail Jacket combines a waterproof 3-layer shell with pit zips and an adjustable storm hood.'
      : 'The Alpine Trail Jacket is a waterproof 3-layer shell designed for wet and windy ridgelines, with pit zips and an adjustable storm hood.';
    const reviews = active.has('reviews-bump') ? '131' : '128';
    const recommended = active.has('recommended-swap')
      ? '<li>Granite Peak Fleece — $79</li><li>Summit Wool Beanie — $24</li>'
      : '<li>Cascade Rain Pants — $89</li><li>Ridgeline Daypack 28L — $119</li>';
    const ad = active.has('ad-change')
      ? 'Sponsored: New season, new gear — save on spring arrivals.'
      : 'Sponsored: Winter clearance — up to 40% off select styles.';

    const body = `
<h1>Alpine Trail Jacket</h1>
<p class="ad-banner">${ad}</p>
<section>
<h2>Overview</h2>
<p>${description}</p>
<p>Price: ${price}</p>
<p>Rated 4.6 out of 5 based on ${reviews} reviews.</p>
</section>
<section>
<h2>Size Availability</h2>
<table>
<tr><th>Size</th><th>Status</th></tr>
<tr><td>S</td><td>In stock</td></tr>
<tr><td>M</td><td>${m}</td></tr>
<tr><td>L</td><td>In stock</td></tr>
<tr><td>XL</td><td>${xl}</td></tr>
<tr><td>XXL</td><td>Sold out</td></tr>
</table>
</section>
<section>
<h2>Shipping and Returns</h2>
<p>Free shipping on orders over $75. Returns are accepted within 30 days of delivery in unworn condition.</p>
</section>
<section class="related-products">
<h2>You may also like</h2>
<ul>
${recommended}
</ul>
</section>`;
    return pageShell('Alpine Trail Jacket | Outfitter Demo Shop', body, '2025');
  }
};

/* ------------------------------------------------------------------ */
/* Page 3: Scholarship, event, and policy                               */
/* ------------------------------------------------------------------ */

const scholarshipPage: LabPage = {
  slug: 'scholarship-event',
  name: 'Cascade Merit Scholarship — Info Page',
  description: 'A fictional scholarship page with an award amount, deadline, eligibility rules, an info-session event, and a reapplication policy.',
  suggestedIntent: 'Tell me if the scholarship application deadline moves.',
  mutations: [
    { id: 'deadline-earlier', label: 'Move the deadline to February 15', kind: 'meaningful', description: 'Application deadline moves from March 1, 2027 to February 15, 2027.' },
    { id: 'award-decrease', label: 'Reduce the award to $4,000', kind: 'meaningful', description: 'Award amount changes from $5,000 to $4,000.' },
    { id: 'location-change', label: 'Move the info session venue', kind: 'meaningful', description: 'The info session moves from Community Hall, Room 204 to the Riverside Conference Center.' },
    { id: 'eligibility-tighten', label: 'Require 15 units per term', kind: 'meaningful', description: 'Eligibility changes from 12 to 15 enrolled units per term.' },
    { id: 'policy-restrict', label: 'Forbid reapplication', kind: 'meaningful', description: 'Policy flips: recipients may no longer reapply in future years.' },
    { id: 'reword-award', label: 'Reword the award sentence (same amount)', kind: 'harmless', description: 'The award sentence is rephrased but still says $5,000.' },
    { id: 'layout-change', label: 'Reorder unrelated sections', kind: 'harmless', description: 'The “How to Apply” and “Selection Timeline” sections swap places.' },
    { id: 'footer-year', label: 'Bump the footer copyright year', kind: 'harmless', description: 'Footer year changes from 2025 to 2026.' }
  ],
  render(active: Set<string>): string {
    const deadline = active.has('deadline-earlier') ? 'February 15, 2027' : 'March 1, 2027';
    const award = active.has('award-decrease') ? '$4,000' : '$5,000';
    const units = active.has('eligibility-tighten') ? '15' : '12';
    const venue = active.has('location-change') ? 'the Riverside Conference Center, 800 River Road' : 'Community Hall, Room 204';
    const policy = active.has('policy-restrict')
      ? 'Recipients may not reapply in future award years.'
      : 'Recipients may reapply in future award years.';
    const awardSentence = active.has('reword-award')
      ? `Each academic year, selected students receive an award of ${award} toward tuition and fees.`
      : `The Cascade Merit Scholarship awards ${award} per academic year toward tuition and fees.`;
    const footerYear = active.has('footer-year') ? '2026' : '2025';

    const howToApply = `<section>
<h2>How to Apply</h2>
<p>Submit the online application form, one letter of recommendation, and a 500 word personal statement. The application deadline is ${deadline}.</p>
</section>`;
    const timeline = `<section>
<h2>Selection Timeline</h2>
<p>Applications open January 5, 2027. Finalists are interviewed in late March, and awards are announced by April 30, 2027.</p>
</section>`;
    const middle = active.has('layout-change') ? timeline + howToApply : howToApply + timeline;

    const body = `
<h1>Cascade Merit Scholarship</h1>
<section>
<h2>Award</h2>
<p>${awardSentence}</p>
</section>
<section>
<h2>Eligibility</h2>
<ul>
<li>Enrolled in at least ${units} units per term at an accredited institution.</li>
<li>A cumulative GPA of 3.50 or higher.</li>
<li>Demonstrated community involvement.</li>
</ul>
</section>
${middle}
<section>
<h2>Information Session</h2>
<p>Join us on February 5, 2027 at 6:00 PM. The session will be held at ${venue}.</p>
</section>
<section>
<h2>Reapplication Policy</h2>
<p>${policy} Awards are not automatically renewed.</p>
</section>`;
    return pageShell('Cascade Merit Scholarship', body, footerYear);
  }
};

/* ------------------------------------------------------------------ */
/* Page 4: Deterministic Transfer GPA workflow fixture                  */
/* Matches the portfolio E2E workflow: Minimum GPA section, deadline,   */
/* and footer — with exact reword / unrelated / meaningful mutations.   */
/* ------------------------------------------------------------------ */

const transferGpaWorkflowPage: LabPage = {
  slug: 'transfer-gpa-workflow',
  name: 'Transfer GPA Workflow Fixture',
  description:
    'Controlled page for the Transfer GPA Requirement end-to-end workflow: Minimum GPA section, unrelated deadline, and footer date.',
  suggestedIntent:
    'Alert me only if the minimum transferable GPA requirement changes. Ignore footer dates, formatting changes, rewording, and application deadlines.',
  mutations: [
    {
      id: 'gpa-increase',
      label: 'Raise minimum GPA to 3.40',
      kind: 'meaningful',
      description: 'Minimum transferable GPA changes from 3.20 to 3.40.'
    },
    {
      id: 'reword-gpa',
      label: 'Reword the GPA sentence (same value)',
      kind: 'harmless',
      description: 'GPA sentence is reworded but still states 3.20.'
    },
    {
      id: 'deadline-change',
      label: 'Move application deadline to October 15',
      kind: 'harmless',
      description: 'Unrelated application deadline change (GPA intent must ignore).'
    },
    {
      id: 'footer-year',
      label: 'Bump the footer copyright year',
      kind: 'harmless',
      description: 'Footer year changes from 2025 to 2026.'
    }
  ],
  render(active: Set<string>): string {
    const gpa = active.has('gpa-increase') ? '3.40' : '3.20';
    const gpaSentence = active.has('reword-gpa')
      ? `Transfer applicants are required to maintain at least a ${gpa} GPA.`
      : `Applicants must have a minimum transferable GPA of ${gpa}.`;
    const deadline = active.has('deadline-change') ? 'October 15, 2026' : 'September 30, 2026';
    const footerYear = active.has('footer-year') ? '2026' : '2025';

    const body = `
<h1>Transfer Admission Requirements</h1>
<p>Review the requirements and deadlines before applying. Content on this page is fictional and used only for controlled evaluation.</p>
<section>
<h2>Minimum GPA</h2>
<p>${gpaSentence}</p>
</section>
<section>
<h2>Application Deadline</h2>
<p>The fall term application deadline is ${deadline}. Late applications are reviewed on a space-available basis.</p>
</section>`;
    return pageShell('Transfer Admission Requirements', body, footerYear);
  }
};

export const LAB_PAGES: LabPage[] = [collegePage, productPage, scholarshipPage, transferGpaWorkflowPage];

export function getLabPage(slug: string): LabPage | undefined {
  return LAB_PAGES.find((p) => p.slug === slug);
}

export function getActiveMutations(slug: string): Set<string> {
  const row = getDb().prepare('SELECT activeMutations FROM lab_page_state WHERE slug = ?').get(slug) as
    | { activeMutations: string }
    | undefined;
  if (!row) return new Set();
  try {
    return new Set(JSON.parse(row.activeMutations) as string[]);
  } catch {
    return new Set();
  }
}

export function setActiveMutations(slug: string, mutations: string[]): void {
  const page = getLabPage(slug);
  if (!page) throw new Error(`Unknown lab page: ${slug}`);
  const valid = mutations.filter((m) => page.mutations.some((x) => x.id === m));
  getDb()
    .prepare(
      `INSERT INTO lab_page_state (slug, activeMutations, updatedAt) VALUES (?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET activeMutations = excluded.activeMutations, updatedAt = excluded.updatedAt`
    )
    .run(slug, JSON.stringify(valid));
}

export function renderLabPage(slug: string): string | null {
  const page = getLabPage(slug);
  if (!page) return null;
  return page.render(getActiveMutations(slug));
}
