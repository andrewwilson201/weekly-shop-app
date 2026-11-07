// Recipe sites → this week's new recipes. Each household lists sites in
// Settings › Recipe sites (The Guardian's recipes feed by default). For each
// site we read its RSS or Atom feed (a page address works too: the page's
// feed link, or /feed, is tried) and keep what was published in the last 7
// days. One of those per site becomes one of the week's ideas.

export const DEFAULT_SOURCES = [{ name: 'The Guardian', url: 'https://www.theguardian.com/tone/recipes/rss' }];
export const MAX_SOURCES = 5;
const DAYS = 7;
const PER_SOURCE = 12;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// A household that has never changed the setting gets the Guardian; an empty list means none.
export function recipeSources(household) {
  const s = household?.recipeSources;
  return (Array.isArray(s) ? s : DEFAULT_SOURCES).filter(x => x?.url).slice(0, MAX_SOURCES);
}

const text = s => String(s ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); // descriptions are often escaped HTML
const tag = (xml, names) => {
  for (const n of names) {
    const m = xml.match(new RegExp(String.raw`<${n}(?:\s[^>]*)?>([\s\S]*?)</${n}>`, 'i'));
    if (m) return m[1];
  }
  return '';
};

export const isFeed = body => /<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 2000));

// RSS 2.0, RSS 1.0 and Atom. Returns [{ title, url, published (ISO), summary }].
export function parseFeed(xml) {
  const out = [];
  for (const [, item] of xml.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)) {
    let url = text(tag(item, ['link']));
    if (!url) {
      const links = [...item.matchAll(/<link\b([^>]*)\/?>/gi)].map(m => m[1]);
      const alt = links.find(a => !/rel=["'](?!alternate)/i.test(a)) || links[0] || '';
      url = (alt.match(/href=["']([^"']+)/i) || [])[1] || '';
    }
    if (!url) url = text(tag(item, ['guid', 'id']));
    const when = new Date(text(tag(item, ['pubDate', 'dc:date', 'published', 'updated'])));
    out.push({
      title: text(tag(item, ['title'])),
      url: url.replace(/&amp;/g, '&').trim(),
      published: isNaN(when) ? null : when.toISOString(),
      summary: text(tag(item, ['description', 'summary', 'content'])).slice(0, 200),
    });
  }
  return out.filter(i => i.title && /^https?:\/\//.test(i.url));
}

// A page that isn't a feed: its <link rel="alternate" type="application/rss+xml">.
export function feedLink(html, base) {
  for (const [l] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']?alternate/i.test(l) || !/type=["']?application\/(rss|atom)\+xml/i.test(l)) continue;
    const href = (l.match(/href=["']([^"']+)/i) || [])[1];
    if (href) try { return new URL(href.replace(/&amp;/g, '&'), base).href; } catch { /* bad href */ }
  }
  return null;
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8', 'accept-language': 'en-GB,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`the site said ${res.status}`);
  return { body: await res.text(), url: res.url || url };
}

// Finds the feed for a site address. Returns { feed, items }.
async function readSource(url) {
  const first = await get(url);
  if (isFeed(first.body)) return { feed: first.url, items: parseFeed(first.body) };
  const tries = [feedLink(first.body, first.url), new URL('/feed', first.url).href, new URL('/rss', first.url).href].filter(Boolean);
  for (const t of [...new Set(tries)]) {
    try { const r = await get(t); if (isFeed(r.body)) return { feed: r.url, items: parseFeed(r.body) }; } catch { /* try the next */ }
  }
  throw new Error('couldn\'t find a recipe feed on that site');
}

// Recent recipes for each source, newest first. A site that fails is reported
// in status and left out; it never stops the week's ideas.
// Returns { recipes: [{ source, title, url, published, summary }], status: [{ url, ok, note }] }.
export async function recentRecipes(sources, { now = new Date(), read = readSource } = {}) {
  if (process.env.FEEDS_FAKE) read = fakeRead;
  const since = now.getTime() - DAYS * 864e5;
  const recipes = [], status = [];
  await Promise.all(sources.map(async s => {
    try {
      const { feed, items } = await read(s.url);
      const recent = items.filter(i => i.published && Date.parse(i.published) >= since && Date.parse(i.published) <= now.getTime() + 864e5)
        .sort((a, b) => b.published.localeCompare(a.published)).slice(0, PER_SOURCE);
      recipes.push(...recent.map(i => ({ source: s.name || hostOf(s.url), ...i })));
      status.push({ url: s.url, ok: true, note: `${recent.length} new in the last week`, ...(feed !== s.url ? { feed } : {}) });
    } catch (e) {
      status.push({ url: s.url, ok: false, note: e.message || String(e) });
      console.log(`Recipe site failed: ${e.message}`);
    }
  }));
  return { recipes, status };
}

export const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

async function fakeRead(src) {
  const now = Date.now(), host = hostOf(src);
  return { feed: 'fake', items: [
    { title: `Pretend ${host} recipe: squash curry`, url: `https://${host}/recipes/squash-curry`, published: new Date(now - 864e5).toISOString(), summary: 'A mild weeknight curry' },
    { title: 'An old recipe', url: `https://${host}/recipes/old`, published: new Date(now - 20 * 864e5).toISOString(), summary: '' },
  ] };
}
