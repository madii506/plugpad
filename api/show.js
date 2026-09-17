// Resolve one input — a show — to a card. Podcast (Apple, Spotify, RSS),
// stream (Twitch, Kick, YouTube) or X account (Spaces). Every branch returns
// the same shape; a branch that cannot read returns ok:false with a reason
// and never invents a title.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const T = 6500;

const get = (url, headers = {}) => fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(T) });
const text = async (url, h) => { const r = await get(url, h); return r.ok ? r.text() : null; };
const json = async (url, h) => { const r = await get(url, { accept: 'application/json', ...h }); return r.ok ? r.json() : null; };
const og = (html, p) => (html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, 'i')) ||
                         html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${p}["']`, 'i')) || [])[1];
const strip = (s = '') => String(s).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
const line = (title) => `plugs ${title} via PLUG`;
const out = (res, body, code = 200) => { res.setHeader('cache-control', 's-maxage=300, stale-while-revalidate=3600'); return res.status(code).json(body); };

export default async function handler(req, res) {
  const raw = String(req.query?.u || '').trim().slice(0, 300);
  if (!raw) return out(res, { ok: false, reason: 'nothing to read' }, 400);
  const t0 = Date.now();
  const done = (o) => out(res, { ...o, input: raw, ms: Date.now() - t0 });
  const fail = (kind, reason, extra = {}) => done({ ok: false, kind, reason, ...extra });

  try {
    let u = raw;
    if (/^@?[A-Za-z0-9_]{1,15}$/.test(u)) u = 'https://x.com/' + u.replace(/^@/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    let url; try { url = new URL(u); } catch { return fail('unknown', 'not a link'); }
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');

    // X — Spaces host
    if (host === 'x.com' || host === 'twitter.com') {
      const h = (path.split('/')[1] || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
      if (!h) return fail('x', 'no handle in that link');
      const m = await json(`https://api.fxtwitter.com/${h}`);
      const usr = m?.user;
      if (!usr) return fail('x', 'x refused the server read', { handle: h });
      return done({ ok: true, kind: 'x spaces', title: usr.name, handle: '@' + usr.screen_name,
        image: `/api/avatar?h=${usr.screen_name}`, url: `https://x.com/${usr.screen_name}`,
        followers: usr.followers, rate: 'none published', line: line('@' + usr.screen_name) });
    }

    // Twitch
    if (host === 'twitch.tv' || host === 'm.twitch.tv') {
      const login = (path.split('/')[1] || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
      if (!login) return fail('stream', 'no channel in that link');
      const av = await text(`https://decapi.me/twitch/avatar/${login}`);
      if (!av || !/^https?:/.test(av)) return fail('stream', 'twitch has no channel by that name', { handle: login });
      return done({ ok: true, kind: 'stream', title: login, handle: 'twitch.tv/' + login, image: av.trim(),
        url: `https://twitch.tv/${login}`, rate: 'none published', line: line('twitch.tv/' + login) });
    }

    // Kick — Cloudflare refuses server reads; say so
    if (host === 'kick.com') {
      const slug = (path.split('/')[1] || '').toLowerCase().replace(/[^a-z0-9_\-]/g, '').slice(0, 40);
      if (!slug) return fail('stream', 'no channel in that link');
      let r = null;
      try { r = await get(`https://kick.com/api/v2/channels/${slug}`, { accept: 'application/json' }); } catch {}
      if (r && r.ok && (r.headers.get('content-type') || '').includes('json')) {
        const j = await r.json();
        return done({ ok: true, kind: 'stream', title: j.user?.username || slug, handle: 'kick.com/' + slug,
          image: j.user?.profile_pic || null, url: `https://kick.com/${slug}`, rate: 'none published', line: line('kick.com/' + slug) });
      }
      return done({ ok: true, kind: 'stream', title: slug, handle: 'kick.com/' + slug, image: null, url: `https://kick.com/${slug}`,
        rate: 'none published', line: line('kick.com/' + slug), note: 'kick refused the server read; the pairing still holds' });
    }

    // YouTube channel / handle
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
      const html = await text(`https://www.youtube.com${path}`, { 'accept-language': 'en' });
      if (!html) return fail('stream', 'youtube refused the server read');
      const title = og(html, 'title'); const image = og(html, 'image');
      if (!title) return fail('stream', 'no channel on that page');
      return done({ ok: true, kind: 'stream', title: strip(title), handle: 'youtube.com' + path, image, url: `https://www.youtube.com${path}`,
        rate: 'none published', line: line(strip(title)) });
    }

    // Apple Podcasts
    if (host === 'podcasts.apple.com') {
      const id = (path.match(/id(\d+)/) || [])[1];
      if (!id) return fail('podcast', 'no show id in that link');
      const j = await json(`https://itunes.apple.com/lookup?id=${id}&entity=podcast`);
      const r0 = j?.results?.[0];
      if (!r0) return fail('podcast', 'apple has no show by that id');
      return done({ ok: true, kind: 'podcast', title: r0.collectionName, handle: r0.artistName, image: r0.artworkUrl600 || r0.artworkUrl100,
        url: r0.collectionViewUrl, feed: r0.feedUrl || null, episodes: r0.trackCount, rate: 'none published', line: line(r0.collectionName) });
    }

    // Spotify show
    if (host === 'open.spotify.com') {
      const j = await json(`https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`);
      if (!j?.title) return fail('podcast', 'spotify refused the server read');
      return done({ ok: true, kind: 'podcast', title: strip(j.title), handle: 'open.spotify.com', image: j.thumbnail_url || null, url: u,
        rate: 'none published', line: line(strip(j.title)) });
    }

    // Anything else: try it as an RSS feed, then as a page
    const body = await text(u);
    if (!body) return fail('podcast', 'that link refused the server read');
    if (/<rss|<feed|<channel/i.test(body)) {
      const title = strip((body.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i) || body.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
      const image = (body.match(/<itunes:image[^>]+href=["']([^"']+)/i) || body.match(/<image>[\s\S]*?<url>([\s\S]*?)<\/url>/i) || [])[1];
      const eps = (body.match(/<item>/gi) || []).length;
      if (!title) return fail('podcast', 'feed has no title');
      return done({ ok: true, kind: 'podcast', title, handle: host, image: image ? strip(image) : null, url: u, feed: u, episodes: eps,
        rate: 'none published', line: line(title) });
    }
    const title = og(body, 'title'); const image = og(body, 'image');
    if (!title) return fail('unknown', 'no show on that page');
    return done({ ok: true, kind: 'podcast', title: strip(title), handle: host, image: image || null, url: u, rate: 'none published', line: line(strip(title)) });
  } catch (e) {
    return fail('unknown', /abort|timeout/i.test(String(e)) ? 'the read timed out' : 'the read failed');
  }
}
