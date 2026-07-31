/**
 * Content-cleaning pipeline.
 *
 * Takes raw fetched HTML and produces readable, structured sections:
 * scripts/styles/navigation/ads/cookie banners/social widgets/hidden
 * content are removed; headings, paragraphs, list items, and tables are
 * preserved with their heading hierarchy. Mozilla Readability is used to
 * isolate the main article content when it produces a good result, with
 * a full-body fallback for pages Readability cannot parse.
 */
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { CleanedPage, Section } from '../types.js';

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas', 'object', 'embed',
  'form', 'button', 'input', 'select', 'textarea', 'nav', 'aside', 'dialog',
  '[hidden]', '[aria-hidden="true"]', '[role="navigation"]', '[role="banner"]',
  '[role="complementary"]', '[role="dialog"]', '[role="alertdialog"]',
  '[style*="display:none"]', '[style*="display: none"]', '[style*="visibility:hidden"]', '[style*="visibility: hidden"]'
].join(',');

const NOISE_PATTERN =
  /(^|[\s_-])(cookie|consent|gdpr|advert|adsense|ad-slot|ad-banner|sponsor|promo(?!tion-details)|newsletter|subscribe|social|share|sharing|related|recommended|recommendation|you-may-also|breadcrumb|skip-link|sidebar|popup|modal|overlay|tooltip|banner-ad)([\s_-]|$)/i;

function isNoiseElement(el: Element): boolean {
  const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
  const idClass = `${attribs['id'] ?? ''} ${attribs['class'] ?? ''}`;
  return NOISE_PATTERN.test(idClass);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Remove non-content markup from a cheerio document in place. */
function stripNoise($: cheerio.CheerioAPI): void {
  $(REMOVE_SELECTORS).remove();
  $('header, footer').each((_, el) => {
    // Keep header/footer elements only when they are small inline wrappers
    // inside an article (rare); remove page-level chrome.
    const $el = $(el);
    if ($el.parents('article, main, section').length === 0 || $el.find('a').length > 3) $el.remove();
  });
  $('div, section, ul, ol, span, p, a, li, table').each((_, el) => {
    if (isNoiseElement(el)) $(el).remove();
  });
}

/** Use Readability to isolate the main content HTML, or null if it fails. */
function readabilityContent(html: string, url: string): string | null {
  try {
    const vc = new VirtualConsole();
    vc.on('error', () => {});
    const dom = new JSDOM(html, { url: url || 'https://example.com/', virtualConsole: vc });
    // keepClasses so the class-based noise filter can still run on the output.
    const article = new Readability(dom.window.document, { charThreshold: 250, keepClasses: true }).parse();
    if (article?.content && collapse(article.textContent ?? '').length >= 250) {
      return article.content;
    }
    return null;
  } catch {
    return null;
  }
}

interface WorkingSection {
  heading: string;
  level: number;
  trail: string[];
  lines: string[];
}

function extractSections($: cheerio.CheerioAPI, root: cheerio.Cheerio<Element>): Section[] {
  const sections: WorkingSection[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let current: WorkingSection = { heading: '', level: 0, trail: [], lines: [] };

  const pushCurrent = () => {
    if (current.lines.length > 0 || current.heading) sections.push(current);
  };

  const addLine = (text: string) => {
    const t = collapse(text);
    if (t.length > 1) current.lines.push(t);
  };

  const nodes = root.find('h1, h2, h3, h4, h5, h6, p, li, tr, dt, dd, blockquote, pre, figcaption');
  nodes.each((_, el) => {
    const tag = el.tagName?.toLowerCase() ?? '';
    const $el = $(el);
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const text = collapse($el.text());
      if (!text) return;
      pushCurrent();
      while (headingStack.length && headingStack[headingStack.length - 1]!.level >= level) headingStack.pop();
      const trail = headingStack.map((h) => h.text);
      headingStack.push({ level, text });
      current = { heading: text, level, trail, lines: [] };
      return;
    }
    if (tag === 'tr') {
      const cells = $el
        .find('th, td')
        .toArray()
        .map((c) => collapse($(c).text()))
        .filter(Boolean);
      if (cells.length > 0) addLine(cells.join(' | '));
      return;
    }
    if (tag === 'li') {
      // Take only the direct text of the li, not nested lists (they appear as
      // their own li nodes) — clone and strip child lists.
      const clone = $el.clone();
      clone.find('ul, ol').remove();
      addLine(clone.text());
      return;
    }
    if (tag === 'p' || tag === 'dt' || tag === 'dd' || tag === 'blockquote' || tag === 'figcaption') {
      // Skip paragraphs that live inside li/td (already captured there).
      if ($el.parents('li, td, th').length > 0) return;
      addLine($el.text());
      return;
    }
    if (tag === 'pre') {
      addLine($el.text());
    }
  });
  pushCurrent();

  // De-duplicate repeated boilerplate lines that appear in 3+ sections
  // (repeated headers/footers that survived earlier passes).
  const lineCounts = new Map<string, number>();
  for (const s of sections) for (const l of new Set(s.lines)) lineCounts.set(l, (lineCounts.get(l) ?? 0) + 1);
  const boilerplate = new Set([...lineCounts.entries()].filter(([, c]) => c >= 3).map(([l]) => l));

  return sections
    .map((s) => {
      const lines = s.lines.filter((l) => !boilerplate.has(l));
      // Drop consecutive duplicates.
      const deduped = lines.filter((l, i) => l !== lines[i - 1]);
      return {
        heading: s.heading || (s.trail.length ? s.trail[s.trail.length - 1]! : 'Introduction'),
        level: s.level,
        trail: s.trail,
        lines: deduped,
        text: deduped.join('\n')
      };
    })
    .filter((s) => s.text.length > 0 || s.heading !== 'Introduction');
}

export function cleanPage(html: string, finalUrl: string): CleanedPage {
  const $raw = cheerio.load(html);
  const title = collapse($raw('title').first().text()) || collapse($raw('h1').first().text()) || finalUrl;

  // Prefer Readability's main-content isolation when it works well.
  const mainHtml = readabilityContent(html, finalUrl);
  let $: cheerio.CheerioAPI;
  if (mainHtml) {
    $ = cheerio.load(mainHtml);
  } else {
    $ = cheerio.load(html);
  }
  stripNoise($);
  let sections = extractSections($, $('body').length ? $('body') : ($.root() as unknown as cheerio.Cheerio<Element>));

  // If Readability was too aggressive (nearly nothing came through), retry
  // on the whole document.
  const totalChars = sections.reduce((s, x) => s + x.text.length, 0);
  if (mainHtml && totalChars < 200) {
    const $full = cheerio.load(html);
    stripNoise($full);
    sections = extractSections($full, $full('body'));
  }

  const fullText = sections.map((s) => `${s.heading}\n${s.text}`).join('\n\n');
  return { title, finalUrl, sections, fullText };
}
