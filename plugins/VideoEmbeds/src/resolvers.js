// resolvers.js – Facebook, Instagram, X/Twitter + cache and resolve()
import { log, UA_DESKTOP, TTL, NEG_TTL, unesc, jsonAfter, jsonAll, shortcodeToId, probeDims } from "./helpers.js";

export const cache = new Map();   // link -> { exp, data }  (data = null on failure)
const pending = new Map(); // link -> Promise

// ---------------------------------------------------------------- persistent cache (survives app restart)
// Stored in vendetta.plugin.storage (plugin file). FB/IG video URLs are signed and expire:
// the expiry time is in the oe= parameter (hex unix timestamp), which sets the entry's validity.
const MAX_SAVED = 150;
const store = () => { try { return vendetta?.plugin?.storage ?? null; } catch { return null; } };

function expFor(url, kind) {
  const m = String(url).match(/[?&]oe=([0-9a-f]{8})\b/i);
  const oe = m ? parseInt(m[1], 16) * 1000 : 0;
  if (oe > Date.now() + 15 * 60 * 1000) return oe - 10 * 60 * 1000;   // 10 min safety margin before expiry
  return Date.now() + (kind === "tw" ? 6 * 60 * 60 * 1000 : TTL);      // X URLs are stable, others are cached briefly
}

let saveTimer;
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const st = store();
    if (!st) return;
    try {
      const now = Date.now();
      const items = [...cache]
        .filter(([, v]) => v.data && v.exp > now)
        .sort((a, b) => b[1].exp - a[1].exp)
        .slice(0, MAX_SAVED);
      const out = {};
      for (const [k, v] of items) out[k] = { exp: v.exp, data: v.data };
      st.vcache = out;
    } catch (e) { log("rvp: saving cache failed:", e?.message ?? e); }
  }, 1000);
}

// call in onLoad: loads saved (still valid) entries
export function loadCache() {
  const st = store();
  if (!st) { log("rvp: persistent storage not available (cache in memory only)"); return; }
  try {
    const now = Date.now();
    let ok = 0, old = 0;
    for (const [k, v] of Object.entries(st.vcache ?? {})) {
      if (v?.data?.url && "thumb" in v.data && v.exp > now) {   // entries saved before thumbnails existed have no "thumb" key -> look them up again
        cache.set(k, { exp: v.exp, data: v.data }); ok++;
      } else old++;
    }
    log("rvp: storage: loaded " + ok + " valid entries (" + old + " expired or without thumbnail skipped)");
  } catch (e) { log("rvp: loading cache failed:", e?.message ?? e); }
}

// ---------------------------------------------------------------- resolvers
const HDRS = {
  "User-Agent": UA_DESKTOP,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
// FB: no cookies (yt-dlp doesn't send them; cookies from earlier requests can change what FB returns)
// Same request headers as yt-dlp sends (std_headers: Accept, Accept-Language, Sec-Fetch-Mode)
const FB_HDRS = {
  "User-Agent": UA_DESKTOP,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-us,en;q=0.5",
  "Sec-Fetch-Mode": "navigate",
};
const FB_FETCH = { headers: FB_HDRS, credentials: "omit" };          // yt-dlp style
const FB_FETCH_BROWSER = { headers: HDRS, credentials: "omit" };   // the headers used before (video was found with these)
const LOGIN_RE = /id="login_form"|id="loginbutton"|You must log in to continue/;

// Dimensions closest to the given position in the text (so we don't pick up another object's dimensions)
function nearDims(text, idx) {
  if (idx < 0) return null;
  const from = Math.max(0, idx - 4000);
  const win = text.slice(from, idx + 4000);
  const pass = (patterns) => {
    let best = null;
    for (const [re, wi, hi] of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(win))) {
        const w = +m[wi], h = +m[hi];
        if (w < 100 || h < 100) continue;
        const dist = Math.abs(from + m.index - idx);
        if (!best || dist < best.dist) best = { w, h, dist };
      }
    }
    return best;
  };
  return (
    pass([
      [/"original_width":(\d+),"original_height":(\d+)/g, 1, 2],
      [/"original_height":(\d+),"original_width":(\d+)/g, 2, 1],
    ]) ||
    pass([
      [/"width":(\d+),"height":(\d+)/g, 1, 2],
      [/"height":(\d+),"width":(\d+)/g, 2, 1],
    ])
  );
}

// ---- Facebook
const fbId = (u) =>
  u.match(/facebook\.com\/reel\/(\d+)/)?.[1] ||
  u.match(/[?&]v=(\d+)/)?.[1] ||
  u.match(/\/videos\/(?:[^\/?#]+\/)?(\d+)/)?.[1] ||
  null;

// An error that won't go away on retry (the link is not a video): no retry, and the failure is remembered for a long time
const permanent = (msg) => Object.assign(new Error(msg), { permanent: true });

// Share link (share/r/XYZ, share/v/XYZ) -> numeric video ID from the page (og:url / canonical points to /reel/<ID>)
function fbIdFromShare(html) {
  const pats = [
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i,
  ];
  for (const re of pats) {
    const m = html.match(re);
    const id = m && fbId(m[1]);
    if (id) return id;
  }
  return null;
}

// yt-dlp: reel -> watch/?v=ID&_rdr, m.facebook.com -> www.facebook.com
function normFB(url) {
  const id = url.match(/facebook\.com\/reel\/(\d+)/)?.[1];
  if (id) return `https://www.facebook.com/watch/?v=${id}&_rdr`;
  return url.replace("://m.facebook.com/", "://www.facebook.com/");
}

// positions where the video ID ("123456...") occurs in the page – used to pick the right video
function anchorsFor(html, id) {
  const out = [];
  if (!id) return out;
  const needle = '"' + id + '"';
  let i = -1;
  while ((i = html.indexOf(needle, i + 1)) >= 0) out.push(i);
  return out;
}
const distTo = (anchors, idx) => anchors.reduce((m, a) => Math.min(m, Math.abs(a - idx)), Infinity);

// DASH manifest (XML text) -> the video representation with the highest bandwidth (video only, no audio)
function dashBestFromXml(xml) {
  const decode = (x) => x.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  let best = null;
  const sets = xml.match(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/g) || [];
  for (const set of sets) {
    const head = set.match(/<AdaptationSet([^>]*)>/)?.[1] ?? "";
    const reps = set.match(/<Representation[\s\S]*?<\/Representation>/g) || [];
    for (const rep of reps) {
      const attrs = rep.match(/<Representation([^>]*)>/)?.[1] ?? "";
      const isVideo = /contentType="video"/.test(head) || /mimeType="video\//.test(head + attrs);
      const base = rep.match(/<BaseURL>([^<]+)<\/BaseURL>/)?.[1];
      if (!isVideo || !base) continue;
      const cand = {
        url: decode(base),
        bw: +(attrs.match(/bandwidth="(\d+)"/)?.[1] ?? 0),
        w: +(attrs.match(/\swidth="(\d+)"/)?.[1] ?? 0),
        h: +(attrs.match(/\sheight="(\d+)"/)?.[1] ?? 0),
      };
      if (!best || cand.bw > best.bw) best = cand;
    }
  }
  return best;
}

// Manifest strings in FB data are sometimes URL-encoded (yt-dlp: unquote_plus)
function fbManifestText(s) {
  if (/^\s*</.test(s)) return s;
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

// Old-style fallback: all manifests found in the page text, the one nearest to the video ID wins
function dashVideoOnly(html, anchors = []) {
  const re = /"(?:manifest_xml|dash_manifest)":"((?:[^"\\]|\\.)*)"/g;
  const found = [];
  let m;
  while ((m = re.exec(html))) {
    let xml;
    try { xml = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    const best = dashBestFromXml(fbManifestText(xml));
    if (best) found.push({ ...best, idx: m.index });
  }
  if (!found.length) return null;
  const pick = anchors.length
    ? found.reduce((p, c) => (distTo(anchors, c.idx) < distTo(anchors, p.idx) ? c : p))
    : found[0];
  return { url: pick.url, w: pick.w, h: pick.h };
}

// ------------------------------------------------------------ yt-dlp style: JSON in <script data-sjs> blocks
// yt-dlp: re.findall(r'data-sjs>({.*?...})</script>') + json.loads, then looks for the Video object with the video ID.
const FB_SJS_FILTER = /"(?:dash_manifest|playable_url|browser_native_|progressive_urls|videoDeliveryResponseFragment|videoDeliveryLegacyFields|thumbnailImage|preferred_thumbnail)/;
function fbSjsBlocks(html) {
  const out = [];
  const re = /data-sjs[^>]*>(\{[\s\S]*?\})<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!FB_SJS_FILTER.test(m[1])) continue;
    try { out.push(JSON.parse(m[1])); } catch {}
  }
  return out;
}

// Keys that hold a playable URL or manifest directly in a video object
const FB_FMT_KEYS = ["playable_url", "playable_url_quality_hd", "browser_native_hd_url", "browser_native_sd_url",
  "dash_manifest", "dash_manifest_xml_string", "manifest_xml"];
const fbHasFormats = (o) =>
  !!(o.videoDeliveryResponseFragment?.videoDeliveryResponseResult || o.videoDeliveryLegacyFields ||
     FB_FMT_KEYS.some((k) => typeof o[k] === "string" && o[k]));
const fbThumbOf = (o) => {
  const u = o?.thumbnailImage?.uri || o?.preferred_thumbnail?.image?.uri;
  return typeof u === "string" && u ? u : null;
};

// Collects every object that carries video formats; each gets the video ID (its own id/videoId, or the nearest ancestor's)
function fbCollectVideos(node, inheritedId, out, depth) {
  if (!node || typeof node !== "object" || depth > 60) return;
  let id = inheritedId;
  if (!Array.isArray(node)) {
    const own = node.videoId ?? node.id;
    if (own != null && /^\d+$/.test(String(own))) id = String(own);
    if (fbHasFormats(node)) out.push({ v: node, id });
  }
  for (const k in node) fbCollectVideos(node[k], id, out, depth + 1);
}

// Formats of one video object (same keys as yt-dlp's parse_graphql_video). Progressive files carry audio; DASH here is video only.
function fbFormatsOf(v) {
  const prog = []; // { url, rank }  (lower rank = better quality, indexes into FB_SRC)
  const add = (u, rank) => { if (typeof u === "string" && /^https?:/.test(u)) prog.push({ url: u, rank }); };
  const legacy = v.videoDeliveryLegacyFields || v;
  const res = v.videoDeliveryResponseFragment?.videoDeliveryResponseResult;
  for (const p of res?.progressive_urls ?? []) {
    add(p?.progressive_url, String(p?.metadata?.quality).toUpperCase() === "HD" ? 0 : 3);
  }
  add(legacy.browser_native_hd_url, 1);
  add(legacy.playable_url_quality_hd, 2);
  add(legacy.browser_native_sd_url, 4);
  add(legacy.playable_url, 5);
  const xmls = [];
  for (const k of ["dash_manifest", "dash_manifest_xml_string", "manifest_xml"]) {
    if (typeof legacy[k] === "string" && legacy[k]) xmls.push(legacy[k]);
  }
  for (const m of res?.dash_manifests ?? []) if (typeof m?.manifest_xml === "string") xmls.push(m.manifest_xml);
  return { prog, xmls };
}

const FB_SRC = ["progressive HD", "browser_native_hd_url", "playable_url_quality_hd", "progressive SD",
  "browser_native_sd_url", "playable_url", "hd_src", "sd_src"];

// ============================================================ Port of yt-dlp facebook.py (the "relay" data path)
// yt-dlp does NOT look for the video by its ID. It takes the first prefetched relay `data` dict of the page, reads the
// video(s) from it (video / nodes / mediaset / event) and builds the formats from the keys of that one video object.
const isDict = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const kidsOf = (x) => (Array.isArray(x) ? x : isDict(x) ? Object.values(x) : []);   // traverse_obj `...`
const nonEmpty = (x) => x != null && !(isDict(x) && !Object.keys(x).length);          // {} and None are "no value"
const firstOf = (obj, ...keys) => { for (const k of keys) { const v = obj?.[k]; if (nonEmpty(v)) return v; } return undefined; };
const asList = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);                  // yt-dlp variadic()
const isMpdUrl = (u) => /\.mpd(?:[?#]|$)/i.test(String(u));                            // determine_ext(url) == "mpd"
const httpUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);   // url_or_none

// yt-dlp: re.findall(r'data-sjs>({.*?"(?:dash_manifest|playable_url(?:_quality_hd)?).*?})</script>')
const FB_RELAY_FILTER = /"(?:dash_manifest|playable_url(?:_quality_hd)?)/;
const FB_RELAY_TARGETS = ["video", "event", "nodes", "node", "mediaset"];

// lambda _, v: any(key.startswith('RelayPrefetchedStreamCache') for key in v)
function fbIsRelayEntry(v) {
  if (Array.isArray(v)) {
    for (const el of v) {
      if (typeof el !== "string") return false;   // (a non-string raises in yt-dlp -> no match)
      if (el.startsWith("RelayPrefetchedStreamCache")) return true;
    }
    return false;
  }
  return isDict(v) && Object.keys(v).some((k) => k.startsWith("RelayPrefetchedStreamCache"));
}

// traverse_obj(blob, 'require', (None, (..., ..., ..., '__bbox', 'require')), <relay entry>, ..., ..., '__bbox', 'result', <data with a target key>)
function fbDataFromBlob(blob) {
  const req = blob?.require;
  if (!Array.isArray(req)) return null;
  const branches = [req];
  for (const x1 of kidsOf(req)) for (const x2 of kidsOf(x1)) for (const x3 of kidsOf(x2)) {
    const r = x3?.__bbox?.require;
    if (Array.isArray(r)) branches.push(r);
  }
  for (const branch of branches) {
    for (const entry of branch) {
      if (!fbIsRelayEntry(entry)) continue;
      for (const e1 of kidsOf(entry)) for (const e2 of kidsOf(e1)) {
        const result = e2?.__bbox?.result;
        if (!isDict(result)) continue;
        for (const [k, v] of Object.entries(result)) {
          if (k === "data" && isDict(v) && FB_RELAY_TARGETS.some((t) => t in v)) return v;
        }
      }
    }
  }
  return null;
}

// The FIRST such data dict in the page (yt-dlp: get_all=False)
function fbRelayPrefetched(html) {
  const re = /data-sjs[^>]*>(\{[\s\S]*?\})<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!FB_RELAY_FILTER.test(m[1])) continue;
    let blob;
    try { blob = JSON.parse(m[1]); } catch { continue; }   // fatal=False -> skipped
    const data = fbDataFromBlob(blob);
    if (data) return data;
  }
  return null;
}

const FB_LEGACY_KEYS = [["playable_url", "sd"], ["playable_url_quality_hd", "hd"], ["playable_url_dash", ""],
  ["browser_native_hd_url", "hd"], ["browser_native_sd_url", "sd"]];
const FB_MANIFEST_KEYS = ["dash_manifest", "playlist", "dash_manifest_xml_string", "manifest_xml"];
const fbManifestOf = (o) => FB_MANIFEST_KEYS.map((k) => o?.[k]).find((x) => typeof x === "string" && x);

// parse_graphql_video(video): the formats of ONE video object (reels: creation_story merged with playback_video)
function fbGraphqlVideo(video, videoId, entries) {
  if (!isDict(video)) return;
  const vId = String(video.videoId || video.id || videoId || "");
  const reel = video.creation_story?.short_form_video_context?.playback_video;
  if (isDict(reel) && Object.keys(reel).length) video = { ...video.creation_story, ...reel };

  const prog = [];   // progressive files (video + audio): { url, fid }
  const xmls = [];   // DASH manifests given as XML text
  const mpds = [];   // DASH manifests given as URLs (.mpd)

  // legacy formats
  const legacy = isDict(video.videoDeliveryLegacyFields) && Object.keys(video.videoDeliveryLegacyFields).length
    ? video.videoDeliveryLegacyFields : video;
  for (const [key, fid] of FB_LEGACY_KEYS) {
    const u = legacy[key];
    if (!u) continue;
    if (isMpdUrl(u)) mpds.push(u); else prog.push({ url: u, fid });
  }
  const legacyMan = fbManifestOf(legacy);
  if (legacyMan) xmls.push(legacyMan);

  // new videoDeliveryResponse formats
  const res = video.videoDeliveryResponseFragment?.videoDeliveryResponseResult;
  const mpdUrls = kidsOf(res?.dash_manifest_urls).map((m) => httpUrl(m?.manifest_url)).filter(Boolean);
  const manifests = kidsOf(res?.dash_manifests).filter((m) => m?.manifest_xml);
  for (const m of manifests) { const x = fbManifestOf(m); if (x) xmls.push(x); }
  if (!manifests.length) mpds.push(...mpdUrls);   // only when the manifests are not already provided
  for (const p of kidsOf(res?.progressive_urls)) {
    if (!p?.progressive_url) continue;
    const q = p?.metadata?.quality;
    prog.push({ url: p.progressive_url, fid: typeof q === "string" ? q.toLowerCase() : "" });
  }

  if (!prog.length && !xmls.length && !mpds.length) return;   // "do not append false positive entry w/o any formats"
  const thumb = video.thumbnailImage?.uri || video.preferred_thumbnail?.image?.uri || null;
  entries.push({ id: vId, prog, xmls, mpds, thumb });
}

// The video objects of a relay data dict, in yt-dlp's order: nodes/attachments, mediaset edges, event cover video / video
function fbEntriesFromData(data, videoId) {
  const entries = [];
  const parseAttachment = (att, key = "media") => {
    const media = att?.[key];
    if (isDict(media) && media.__typename === "Video") fbGraphqlVideo(media, videoId, entries);
  };

  const attachments = [];
  for (const node of asList(firstOf(data, "nodes", "node") ?? [])) {
    const story = node?.comet_sections?.content?.story;
    for (const st of [story, story?.attached_story]) {
      for (const att of kidsOf(st?.attachments)) {
        for (const r of [att?.styles, att?.style_type_renderer, att?.throwbackStyles?.attachment_target_renderer]) {
          const a = r?.attachment;
          if (isDict(a) && Object.keys(a).length) attachments.push(a);
        }
      }
    }
  }
  for (const attachment of attachments) {
    let ns = kidsOf(attachment.all_subattachments?.nodes).filter((n) => isDict(n) && Object.keys(n).length);
    if (!ns.length) {
      ns = kidsOf(attachment.target?.attachments).map((a) => a?.styles?.attachment).filter((n) => isDict(n) && Object.keys(n).length);
    }
    for (const n of ns) parseAttachment(n);
    parseAttachment(attachment);
  }

  for (const edge of asList(data.mediaset?.currMedia?.edges).filter(isDict)) parseAttachment(edge, "node");

  const video = [data.event?.cover_media_renderer?.cover_video, data.video].find((v) => isDict(v) && Object.keys(v).length);
  if (video) {
    const atts = [video.story?.attachments, video.creation_story?.attachments].find(Array.isArray) ?? [];
    for (const a of atts) parseAttachment(a);
    if (!entries.length) fbGraphqlVideo(video, videoId, entries);
  }
  return entries;
}

// DASH manifests given as a URL: download and parse (BaseURL made absolute)
async function fbFromMpds(mpds) {
  for (const u of mpds) {
    try {
      log("rvp: FB downloading DASH manifest:", u);
      const xml = await (await fetch(u, FB_FETCH)).text();
      const d = dashBestFromXml(xml);
      if (!d) { log("rvp: FB DASH manifest has no video representation (" + xml.length + " B)"); continue; }
      if (!/^https?:/i.test(d.url)) d.url = u.replace(/[?#].*$/, "").replace(/[^/]*$/, "") + d.url;
      return d;
    } catch (e) { log("rvp: FB DASH manifest failed:", e?.message ?? e); }
  }
  return null;
}

// One parsed entry -> { url, w, h, thumb, note? }. Files with audio first (hd before sd), then DASH (video only).
async function fbResultFromEntry(e, where) {
  const rank = (fid) => (fid === "hd" ? 0 : fid === "sd" ? 1 : 2);
  if (e.prog.length) {
    const best = e.prog.map((p, i) => ({ ...p, i })).sort((a, b) => rank(a.fid) - rank(b.fid) || a.i - b.i)[0];
    log("rvp: FB yt-dlp path [" + where + "]: progressive " + (best.fid || "?") + " (of " + e.prog.length + "), thumbnail=" + (e.thumb ? "yes" : "no"));
    return { url: best.url, w: 0, h: 0, thumb: e.thumb };
  }
  for (const x of e.xmls) {
    const d = dashBestFromXml(fbManifestText(x));
    if (d) {
      log("rvp: FB yt-dlp path [" + where + "]: DASH manifest only, thumbnail=" + (e.thumb ? "yes" : "no"));
      return { url: d.url, w: d.w, h: d.h, thumb: e.thumb, note: "FB: DASH only, video without audio" };
    }
  }
  if (e.mpds.length) {
    const d = await fbFromMpds(e.mpds);
    if (d) return { url: d.url, w: d.w, h: d.h, thumb: e.thumb, note: "FB: DASH only, video without audio" };
  }
  return null;
}

async function fbFromYtdlp(html, id, where) {
  const data = fbRelayPrefetched(html);
  if (!data) { log("rvp: FB yt-dlp path [" + where + "]: no relay data with " + FB_RELAY_TARGETS.join("/")); return null; }
  const entries = fbEntriesFromData(data, id);
  log("rvp: FB yt-dlp path [" + where + "]: data keys=" + JSON.stringify(Object.keys(data)) + ", video entries=" + entries.length +
    ", IDs=" + JSON.stringify(entries.map((x) => x.id).slice(0, 6)));
  if (!entries.length) return null;
  // yt-dlp returns a playlist for several entries; we need one: the entry with our ID, else the first
  const e = (entries.length > 1 && id && entries.find((x) => x.id === String(id))) || entries[0];
  return await fbResultFromEntry(e, where);
}

// Old-style data (yt-dlp: handleServerJS / s.handle and the tahoe response): jsmods "instances" -> VideoConfig -> videoData
function fbFromInstances(instances, id, where) {
  if (!Array.isArray(instances)) return null;
  const vds = [];
  for (const item of instances) {
    if (item?.[1]?.[0] === "VideoConfig") {
      const vi = item?.[2]?.[0];
      if (vi?.video_id) vds.push(vi);
    }
  }
  if (!vds.length) return null;
  const vi = (vds.length > 1 && id && vds.find((v) => String(v.video_id) === String(id))) || vds[0];
  const prog = [], xmls = [];
  for (const f0 of asList(vi.videoData)) {
    const f = isDict(f0) ? f0 : Array.isArray(f0) ? f0[0] : null;
    if (!isDict(f)) continue;
    for (const q of ["sd", "hd"]) for (const t of ["src", "src_no_ratelimit"]) {
      const s = f[q + "_" + t];
      if (s) prog.push({ url: s, fid: q });
    }
    const man = fbManifestOf(f);
    if (man) xmls.push(man);
  }
  log("rvp: FB VideoConfig [" + where + "]: files=" + prog.length + ", manifests=" + xmls.length);
  return prog.length || xmls.length ? { id: String(vi.video_id), prog, xmls, mpds: [], thumb: null } : null;
}
function fbFromServerJs(html, id, where) {
  for (const re of [/handleServerJS\((\{.+\})(?:\);|,")/, /\bs\.handle\((\{.+?\})\);/]) {
    const m = html.match(re);
    if (!m) continue;
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    const e = fbFromInstances(j?.instances, id, where);
    if (e) return e;
  }
  return null;
}
// The tahoe response: `for (;;);` + JSON with jsmods.instances
function fbFromTahoeText(text, id, where) {
  const m = text.match(/for\s*\(\s*;\s*;\s*\)\s*;([\s\S]+)/);
  let j;
  try { j = JSON.parse(m ? m[1] : text); } catch { return null; }
  return fbFromInstances(j?.jsmods?.instances, id, where);
}

// Fallback: the video and its thumbnail from the JSON object whose nearest id is this video ID
function fbFromRelay(html, id, where) {
  const found = [];
  for (const b of fbSjsBlocks(html)) fbCollectVideos(b, null, found, 0);
  const ids = [...new Set(found.map((c) => c.id))].slice(0, 6);
  if (!found.length) { log("rvp: FB JSON [" + where + "]: no video objects with formats"); return null; }
  const pool = id ? found.filter((c) => c.id === String(id)) : found;
  log("rvp: FB JSON [" + where + "]: video objects=" + found.length + ", with this ID=" + pool.length + ", IDs seen=" + JSON.stringify(ids));
  if (!pool.length) return null;

  let pick = null;
  for (const c of pool) {
    const f = fbFormatsOf(c.v);
    const cand = { c, f };
    if (f.prog.length) { pick = cand; break; }
    if (!pick && f.xmls.length) pick = cand;
  }
  if (!pick) return null;

  // a thumbnail from the chosen object, else from any other object with this ID
  const thumb = fbThumbOf(pick.c.v) || pool.map((c) => fbThumbOf(c.v)).find(Boolean) || null;
  if (pick.f.prog.length) {
    const best = pick.f.prog.slice().sort((a, b) => a.rank - b.rank)[0];
    log("rvp: FB JSON [" + where + "]: selected=" + FB_SRC[best.rank] + ", thumbnail=" + (thumb ? "yes" : "no"));
    return { url: best.url, w: 0, h: 0, thumb };
  }
  for (const x of pick.f.xmls) {
    const d = dashBestFromXml(fbManifestText(x));
    if (d) {
      log("rvp: FB JSON [" + where + "]: DASH only, thumbnail=" + (thumb ? "yes" : "no"));
      return { url: d.url, w: d.w, h: d.h, thumb, note: "FB: DASH only, video without audio" };
    }
  }
  return null;
}

// Thumbnail of the page: the Video object with this ID, else og:image / twitter:image (yt-dlp ignores URLs without .jpg/.png)
function walkThumb(o, id, depth) {
  if (!o || typeof o !== "object" || depth > 40) return null;
  if (!Array.isArray(o) && (String(o.id) === id || String(o.videoId) === id)) {
    const u = fbThumbOf(o);
    if (u) return u;
  }
  for (const k in o) {
    const r = walkThumb(o[k], id, depth + 1);
    if (r) return r;
  }
  return null;
}
function fbOgThumb(html) {
  const og =
    html.match(/<meta[^>]+(?:property|name)="(?:og|twitter):image(?::secure_url)?"[^>]+content="([^"]+)"/i) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="(?:og|twitter):image"/i);
  return og && /\.(?:jpg|png)/.test(og[1]) ? og[1].replace(/&amp;/g, "&") : null;
}
// Last resort: thumbnail fields found in the page TEXT, only those close to a place where the video ID occurs
function fbThumbRegex(html, id) {
  const anchors = anchorsFor(html, id);
  if (!anchors.length) return null;
  const res = [
    /"preferred_thumbnail":\s*\{\s*"image":\s*\{[^{}]*?"uri":"([^"]+)"/g,
    /"thumbnailImage":\s*\{[^{}]*?"uri":"([^"]+)"/g,
    /"(?:thumbnail_image|previewImage|preview_image|poster_image|first_frame_thumbnail)":\s*\{[^{}]*?"uri":"([^"]+)"/g,
    /"(?:thumbnail_src|thumbnailUrl|thumbnail_url|video_preview_image_url|poster)":\s*"(https?:[^"]+)"/g,
  ];
  let best = null;
  for (const re of res) {
    let m;
    while ((m = re.exec(html))) {
      const d = distTo(anchors, m.index);
      if (d <= 30000 && (!best || d < best.d)) best = { u: unesc(m[1]), d };
    }
  }
  return best ? best.u : null;
}

// When no thumbnail was found: what does the page contain? (so the search can be fixed)
function fbThumbDiag(html, id) {
  try {
    const keys = new Map();
    const kr = /"([A-Za-z_]*(?:thumb|poster|preview)[A-Za-z_]*)":\s*(\{[^{}]{0,120}|"[^"]{0,100})/gi;
    let k;
    while ((k = kr.exec(html)) && keys.size < 12) if (!keys.has(k[1])) keys.set(k[1], k[2].slice(0, 90));
    const og = html.match(/<meta[^>]+(?:property|name)="(?:og|twitter):image"[^>]*>/i)?.[0];
    log("rvp: FB thumbnail diag: page=" + html.length + " B, data-sjs blocks=" + (html.match(/data-sjs/g) || []).length +
      ", ID anchors=" + anchorsFor(html, id).length + ", og:image tag=" + (og ? og.slice(0, 160) : "none"));
    log("rvp: FB thumbnail diag keys:", keys.size ? JSON.stringify([...keys]) : "none");
  } catch {}
}

function fbPageThumb(html, id) {
  try {
    if (id) {
      for (const b of fbSjsBlocks(html)) {
        const u = walkThumb(b, String(id), 0);
        if (u) return u;
      }
    }
  } catch (e) { log("rvp: FB page thumbnail failed:", e?.message ?? e); }
  return fbOgThumb(html) || fbThumbRegex(html, id);
}

// Old-style fallback: scan the page TEXT for known keys (used when the JSON objects don't have the video ID)
function parseFBText(html, id, where = "main page") {
  const cands = []; // { url, idx, rank }
  const addStr = (key, rank) => {
    const re = new RegExp('"' + key + '":"([^"]+)"', "g");
    let m;
    while ((m = re.exec(html))) cands.push({ url: unesc(m[1]), idx: m.index, rank });
  };
  for (const { idx, value } of jsonAll(html, "progressive_urls")) {
    if (!Array.isArray(value)) continue;
    for (const [q, rank] of [["HD", 0], ["SD", 3]]) {
      const u = value.find((p) => String(p?.metadata?.quality).toUpperCase() === q)?.progressive_url;
      if (u) cands.push({ url: u, idx, rank });
    }
  }
  addStr("browser_native_hd_url", 1);
  addStr("playable_url_quality_hd", 2);
  addStr("browser_native_sd_url", 4);
  addStr("playable_url", 5);
  addStr("hd_src_no_ratelimit", 6); addStr("hd_src", 6);
  addStr("sd_src_no_ratelimit", 7); addStr("sd_src", 7);

  const anchors = anchorsFor(html, id);
  if (cands.length) {
    let pick;
    if (anchors.length) {
      // closest match to the video ID, then the best quality around it (the same video)
      const nearest = cands.reduce((p, c) => (distTo(anchors, c.idx) < distTo(anchors, p.idx) ? c : p));
      pick = cands
        .filter((c) => Math.abs(c.idx - nearest.idx) <= 3000)
        .sort((x, y) => x.rank - y.rank || Math.abs(x.idx - nearest.idx) - Math.abs(y.idx - nearest.idx))[0];
    } else {
      pick = cands.slice().sort((x, y) => x.rank - y.rank || x.idx - y.idx)[0];
    }
    const d = nearDims(html, pick.idx);
    log("rvp: FB text [" + where + "]: candidates=" + cands.length + ", ID anchors=" + anchors.length +
      ", selected=" + FB_SRC[pick.rank] + ", " +
      (anchors.length ? "distance from ID=" + distTo(anchors, pick.idx) : "NO ID anchor -> taking the first match (risk of a different video)") +
      ", dimensions=" + (d ? d.w + "x" + d.h : "?"));
    return { url: pick.url, w: d?.w || 0, h: d?.h || 0 };
  }
  log("rvp: FB text [" + where + "]: no progressive candidates, trying DASH (ID anchors=" + anchors.length + ")");
  const dash = dashVideoOnly(html, anchors);
  return dash ? { ...dash, note: "FB: DASH only, video without audio" } : null;
}

// One page -> result. Order: 1) yt-dlp's relay data path, 2) old-style VideoConfig data (handleServerJS),
// 3) the ID-based JSON search, 4) the text scan. The thumbnail is completed from the page if missing.
async function parseFB(html, id, where, pageThumb) {
  let out = null;
  try { out = await fbFromYtdlp(html, id, where); } catch (e) { log("rvp: FB yt-dlp path failed:", e?.message ?? e); }
  if (!out) {
    try {
      const e = fbFromServerJs(html, id, where);
      if (e) out = await fbResultFromEntry(e, where);
    } catch (e) { log("rvp: FB handleServerJS path failed:", e?.message ?? e); }
  }
  if (!out) { try { out = fbFromRelay(html, id, where); } catch (e) { log("rvp: FB JSON failed:", e?.message ?? e); } }
  if (!out) out = parseFBText(html, id, where);
  if (!out) return null;
  if (!out.thumb) out.thumb = pageThumb || fbPageThumb(html, id) || null;
  return out;
}

// yt-dlp's second request when the first page has no video data: POST to the "tahoe" player endpoint with tokens from the page
async function fbTahoe(html, id) {
  const pick = (re, d) => html.match(re)?.[1] ?? d;
  const body = [
    ["__a", "1"],
    ["__pc", pick(/pkg_cohort["']\s*:\s*["'](.+?)["']/, "PHASED:DEFAULT")],
    ["__rev", pick(/client_revision["']\s*:\s*(\d+),/, "3944515")],
    ["fb_dtsg", pick(/"DTSGInitialData"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/, "")],
  ].map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
  const u = `https://www.facebook.com/video/tahoe/async/${id}/?chain=true&isvideo=true&payloadtype=primary`;
  log("rvp: FB tahoe request:", u);
  const r = await fetch(u, {
    method: "POST",
    headers: { ...FB_HDRS, "Content-Type": "application/x-www-form-urlencoded" },
    credentials: "omit",
    body,
  });
  return await r.text();
}

// Debug: when nothing was found, log what the page we received looks like (compare with what yt-dlp gets)
function fbPageSummary(html, id) {
  try {
    const title = html.match(/<title[^>]*>([^<]{0,120})/i)?.[1]?.trim() ?? null;
    let blocks = 0, withKeys = 0, parsed = 0, m;
    const re = /data-sjs[^>]*>(\{[\s\S]*?\})<\/script>/g;
    while ((m = re.exec(html))) {
      blocks++;
      if (!FB_RELAY_FILTER.test(m[1])) continue;
      withKeys++;
      try { JSON.parse(m[1]); parsed++; } catch {}
    }
    const keys = new Map();
    const kr = /"([A-Za-z_]*(?:playable|browser_native|progressive|dash_manifest|hls_playlist|thumbnail|short_form_video|playback_video|videoDelivery)[A-Za-z_]*)"\s*:/g;
    let k;
    while ((k = kr.exec(html))) keys.set(k[1], (keys.get(k[1]) || 0) + 1);
    const idCount = id ? html.split('"' + id + '"').length - 1 : 0;
    log("rvp: FB PAGE SUMMARY: title=" + JSON.stringify(title) + ", size=" + html.length + " B, data-sjs blocks=" + blocks +
      ", blocks with video keys=" + withKeys + " (parsed OK: " + parsed + "), ID occurrences=" + idCount + ", login wall=" + LOGIN_RE.test(html));
    log("rvp: FB PAGE SUMMARY keys:", keys.size ? JSON.stringify([...keys].slice(0, 25)) : "none");
  } catch (e) { log("rvp: FB page summary failed:", e?.message ?? e); }
}

async function resolveFB(url) {
  const first = normFB(url);
  let html = "", final = first, id = null, loginWall = false, pageThumb = null, out = null;
  for (const [name, opts] of [["browser headers", FB_FETCH_BROWSER], ["yt-dlp headers", FB_FETCH]]) {
    log("rvp: FB fetching page (" + name + "):", first);
    const r = await fetch(first, opts);
    final = r.url || first;
    html = await r.text();
    id = fbId(final) || fbId(url);
    loginWall = LOGIN_RE.test(html);
    log("rvp: FB response: status=" + r.status + ", final URL=" + final + ", video ID=" + (id ?? "unknown") +
      ", size=" + html.length + " B, login wall=" + loginWall);
    pageThumb = fbPageThumb(html, id);
    log("rvp: FB page thumbnail:", pageThumb ?? "none");
    out = await parseFB(html, id, "main page, " + name, pageThumb);
    if (out || !id) break;   // without a video ID a second fetch would give the same page
  }
  // the thumbnail of the main page is also used when the video itself had to be taken from another request
  const done = (o) => {
    if (!o.thumb) o.thumb = pageThumb;
    if (!o.thumb) fbThumbDiag(html, id);
    log("rvp: FB thumbnail:", o.thumb ?? "none found");
    return o;
  };

  if (out) return done(out);

  // share link: get the numeric ID and process it as facebook.com/reel/<ID>/ (where a browser redirects too)
  if (!id) {
    const sid = fbIdFromShare(html);
    log("rvp: FB share link -> video ID:", sid ?? "none");
    if (sid) return await resolveFB(`https://www.facebook.com/reel/${sid}/`);
    // without a video ID it's an ordinary page/post – we don't look for a video there
    if (!loginWall) throw permanent("FB: link is not a video (page or post)");
  }

  if (id) {
    // yt-dlp: no video data in the page -> second request to the tahoe endpoint
    try {
      const t = await fbTahoe(html, id);
      log("rvp: FB tahoe response:", t.length + " B");
      let o = null;
      try {
        const e = fbFromTahoeText(t, id, "tahoe");   // yt-dlp: for (;;); + JSON -> jsmods.instances -> VideoConfig
        if (e) o = await fbResultFromEntry(e, "tahoe");
      } catch (e) { log("rvp: FB tahoe instances failed:", e?.message ?? e); }
      if (!o) o = await parseFB(t, id, "tahoe", pageThumb);
      if (o) return done(o);
    } catch (e) { log("rvp: FB tahoe failed:", e?.message ?? e); }

    // other variants of the same page – FB sometimes doesn't provide data for one of them
    log("rvp: FB trying alternative URLs for ID " + id);
    const alts = [
      `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent("https://www.facebook.com/watch/?v=" + id)}&show_text=false`,
      `https://www.facebook.com/watch/?v=${id}`,
      `https://www.facebook.com/video.php?v=${id}`,
      `https://www.facebook.com/video/video.php?v=${id}`,
    ].filter((u) => u !== first);
    for (const u of alts) {
      try {
        const h = await (await fetch(u, FB_FETCH)).text();
        if (LOGIN_RE.test(h)) loginWall = true;
        log("rvp: FB alternative:", u, "(" + h.length + " B)");
        const o = await parseFB(h, id, "alternative", pageThumb);
        if (o) return done(o);
      } catch (e) { log("rvp: FB alternative failed:", u, e?.message ?? e); }
    }
  }
  fbPageSummary(html, id);
  throw new Error(loginWall ? "FB: login required" : "FB: no progressive or DASH video");
}

// ---- Instagram
const isLoginRedirect = (u) => {
  try { const p = new URL(u).pathname; return p.startsWith("/accounts/login") || p === "/"; }
  catch { return false; }
};

// Finds the media object with the given shortcode in <script ... data-sjs> JSON blocks
function findIGMedia(html, code) {
  const codes = new Set([code]);
  if (code.length > 28) codes.add(code.slice(0, -28));
  const re = /<script[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const txt = m[1];
    if (![...codes].some((c) => txt.includes(c))) continue;
    let json;
    try { json = JSON.parse(txt); } catch { continue; }
    const stack = [json];
    let n = 0;
    while (stack.length && n++ < 300000) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      if (!Array.isArray(o) && codes.has(o.code) &&
          ("video_versions" in o || "image_versions2" in o || "media_type" in o || "carousel_media" in o)) return o;
      for (const k in o) { const v = o[k]; if (v && typeof v === "object") stack.push(v); }
    }
  }
  return null;
}

// returns the object with video_versions (directly or the first video in a carousel), otherwise null
function igVideoOf(media) {
  if (Array.isArray(media.video_versions) && media.video_versions.length) return media;
  const slide = (media.carousel_media ?? []).find((c) => Array.isArray(c?.video_versions) && c.video_versions.length);
  return slide ?? null;
}

// Thumbnail URL of an Instagram media object (largest still image)
const ogImage = (html) => {
  const m = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
            html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
  return m ? m[1].replace(/&amp;/g, "&") : null;
};
const igThumb = (o) => o?.image_versions2?.candidates?.[0]?.url || o?.display_url || o?.thumbnail_src || null;

async function resolveIG(url) {
  let u = url;
  if (/instagram\.com\/share\//.test(u)) {           // share links redirect to the real post
    const r = await fetch(u, { headers: HDRS });
    u = r.url || u;
    log("rvp: IG share link redirected to:", u);
  }
  if (/\/reels?\/audio\//.test(u)) throw new Error("IG: audio page");
  const code = u.match(/instagram\.com\/(?:[^\/?#]+\/)?(?:p|tv|reels?)\/([^\/?#&]+)/)?.[1];
  if (!code) throw new Error("IG: invalid link");
  log("rvp: IG shortcode=" + code + ", type=" + (/\/(?:reels?|tv)\//.test(u) ? "reel/tv (always video)" : "post"));

  const fromVersions = (vs, fallback, thumb) => {
    if (!Array.isArray(vs)) return null;
    const best = vs.filter((v) => v?.url).sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    if (!best) return null;
    log("rvp: IG thumbnail:", thumb || "none");
    return { url: best.url, w: best.width || fallback?.w || 0, h: best.height || fallback?.h || 0, thumb: thumb || null };
  };

  // 1) main post page: find exactly the media with this shortcode (not "related" videos on the page)
  let notVideo = false;
  try {
    const r = await fetch(`https://www.instagram.com/p/${code}`, { headers: HDRS });
    log("rvp: IG 1) post page: status=" + r.status + ", final URL=" + r.url + ", login redirect=" + isLoginRedirect(r.url));
    if (!isLoginRedirect(r.url)) {
      const html = await r.text();
      const media = findIGMedia(html, code);
      log("rvp: IG 1) media object with this shortcode: " + (media ? "found" : "NOT FOUND") + ", size=" + html.length + " B");
      if (media) {
        const v = igVideoOf(media);
        if (v) {
          const hit = fromVersions(v.video_versions, { w: v.original_width, h: v.original_height }, igThumb(v) || igThumb(media) || ogImage(html));
          if (hit) return hit;
        } else {
          notVideo = true; // the post is an image
        }
      } else if (/\/(?:reels?|tv)\//.test(u)) {
        // structure not found, but reel/tv is always a video
        const od = html.match(/"original_width":(\d+),"original_height":(\d+)/);
        const hit = fromVersions(jsonAfter(html, "video_versions"), od && { w: +od[1], h: +od[2] }, jsonAfter(html, "image_versions2")?.candidates?.[0]?.url || ogImage(html));
        if (hit) return hit;
      }
    }
  } catch (e) { log("IG page failed", e); }
  if (notVideo) throw new Error("IG: post is not a video");

  // 2) embed page (yt-dlp no longer uses it; may or may not work)
  for (const path of ["embed/captioned/", "embed/"]) {
    try {
      const html = await (await fetch(`https://www.instagram.com/p/${code}/${path}`, { headers: HDRS })).text();
      log("rvp: IG 2) embed " + path + " (" + html.length + " B)");
      const m = html.match(/video_url\\*":\\*"(https:[^"]*)"/);
      if (!m) continue;
      const v = m[1].replace(/\\+$/, "").replace(/\\+u0026/g, "&").replace(/\\+\//g, "/");
      const dm =
        html.match(/dimensions\\*":\{\\*"height\\*":(\d+),\\*"width\\*":(\d+)/) ||
        html.match(/dimensions\\*":\{\\*"width\\*":(\d+),\\*"height\\*":(\d+)/);
      let w = 0, h = 0;
      if (dm) {
        const [a, b] = [+dm[1], +dm[2]];
        const heightFirst = /dimensions\\*":\{\\*"height/.test(dm[0]);
        h = heightFirst ? a : b;
        w = heightFirst ? b : a;
      }
      const tm = html.match(/(?:display_url|thumbnail_src)\\*":\\*"(https:[^"]*)"/);
      const thumb = tm ? tm[1].replace(/\\+$/, "").replace(/\\+u0026/g, "&").replace(/\\+\//g, "/") : null;
      return { url: v, w, h, thumb: thumb || ogImage(html) };
    } catch (e) { log("IG embed failed", e); }
  }

  // 3) web API (yt-dlp uses it only when logged in – without a sessionid it returns a login page)
  const r = await fetch(`https://www.instagram.com/api/v1/media/${shortcodeToId(code)}/info/`, {
    headers: {
      "User-Agent": UA_DESKTOP,
      "X-IG-App-ID": "936619743392459",
      "X-ASBD-ID": "359341",
      "X-IG-WWW-Claim": "0",
      Origin: "https://www.instagram.com",
      Accept: "*/*",
    },
  });
  log("rvp: IG 3) web API: status=" + r.status);
  if (!r.ok) throw new Error("IG: login required (" + r.status + ")");
  const item = (await r.json()).items?.[0];
  const hit = fromVersions(item?.video_versions, item && { w: item.original_width, h: item.original_height }, igThumb(item));
  if (!hit) throw new Error("IG: no video");
  return hit;
}

// ---- X / Twitter (port yt-dlp twitter.py: GraphQL TweetResultByRestId + syndication fallback)
const TW_AUTH = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const TW_GQL = "https://x.com/i/api/graphql/2ICDjqPd81tulZcYrtpTuQ/TweetResultByRestId";

const twParse = (u) => {
  const m = u.match(/(?:(?:i\/web|[^\/\s?#]+)\/status|statuses)\/(\d+)(?:\/(?:video|photo)\/(\d+))?/);
  return m ? { id: m[1], index: m[2] ? +m[2] : 0 } : null;
};

let twGuest = null; // { token, exp }
async function twGuestToken(force) {
  if (!force && twGuest && Date.now() < twGuest.exp) return twGuest.token;
  const r = await fetch("https://api.x.com/1.1/guest/activate.json", {
    method: "POST",
    headers: { "User-Agent": UA_DESKTOP, Authorization: "Bearer " + TW_AUTH },
  });
  const j = await r.json().catch(() => null);
  if (!j?.guest_token) throw new Error("X: guest token failed (" + r.status + ")");
  twGuest = { token: j.guest_token, exp: Date.now() + 30 * 60 * 1000 };
  return j.guest_token;
}

// GraphQL response -> "legacy" status (like _graphql_to_legacy in yt-dlp)
function twGraphqlToStatus(data) {
  let res = data?.tweetResult?.result ?? {};
  const fatal = (msg) => Object.assign(new Error(msg), { fatal: true });
  if (res.tombstone) {
    const cause = String(res.tombstone?.text?.text ?? "").replace(/\. Learn more$/, "");
    throw fatal("X: " + (cause || "tweet unavailable"));
  }
  if (res.__typename === "TweetUnavailable") {
    const reason = res.reason;
    if (reason === "NsfwLoggedOut" || reason === "NsfwViewerHasNoStatedAge") throw fatal("X: NSFW tweet requires login");
    if (reason === "Protected") throw fatal("X: protected tweet");
    throw fatal("X: " + (reason || "tweet unavailable"));
  }
  if (res.__typename === "TweetWithVisibilityResults") res = res.tweet ?? {};
  const st = { ...(res.legacy ?? {}) };
  const q = res.quoted_status_result?.result;
  st.quoted_status = q?.legacy ?? q?.tweet?.legacy;
  st.retweeted_status = res.legacy?.retweeted_status_result?.result?.legacy;
  return st;
}

async function twGraphql(id) {
  const q = {
    variables: { tweetId: id, withCommunity: false, includePromotedContent: false, withVoice: false },
    features: {
      creator_subscriptions_tweet_preview_api_enabled: true,
      tweetypie_unmention_optimization_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: false,
      tweet_awards_web_tipping_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      responsive_web_media_download_video_enabled: false,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    },
    fieldToggles: { withArticleRichContentState: false },
  };
  const qs = Object.keys(q).map((k) => k + "=" + encodeURIComponent(JSON.stringify(q[k]))).join("&");
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await twGuestToken(attempt > 0);
    const r = await fetch(TW_GQL + "?" + qs, {
      headers: {
        "User-Agent": UA_DESKTOP,
        Authorization: "Bearer " + TW_AUTH,
        "x-guest-token": token,
        "x-twitter-client-language": "en",
      },
    });
    if (r.status === 429) throw new Error("X: rate limit");
    const j = await r.json().catch(() => null);
    const errs = [...new Set((j?.errors ?? []).map((e) => e?.message).filter(Boolean))]
      .filter((m) => String(m).toLowerCase() !== "dependency: unspecified");
    if ((r.status === 401 || r.status === 403) && attempt === 0) { lastErr = "HTTP " + r.status; continue; } // stale guest token
    if (errs.length) throw new Error("X API: " + errs.join(", "));
    if (!j?.data) throw new Error("X: empty response (" + r.status + ")");
    return twGraphqlToStatus(j.data);
  }
  throw new Error("X: " + lastErr);
}

// Fallback: syndication endpoint (less data, but no token needed)
async function twSyndication(id) {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`, {
    headers: { "User-Agent": "Googlebot" },
  });
  if (!r.ok) throw new Error("X syndication: " + r.status);
  const st = await r.json().catch(() => null);
  if (!st || (!st.mediaDetails && !st.quoted_tweet)) throw new Error("X syndication: empty response");
  return { extended_entities: { media: [...(st.mediaDetails ?? []), ...(st.quoted_tweet?.mediaDetails ?? [])] } };
}

function twPick(status, index) {
  const st = status.retweeted_status ?? status;
  const media = [...(st.extended_entities?.media ?? []), ...(st.quoted_status?.extended_entities?.media ?? [])];
  let m;
  if (index) {
    m = media[index - 1];
    if (!m) throw new Error("X: video #" + index + " is not available");
    if (m.type === "photo") throw new Error("X: media #" + index + " is not a video");
  } else {
    m = media.find((x) => x?.type !== "photo");
  }
  if (!m) throw new Error("X: tweet contains no video");

  const vs = (m.video_info?.variants ?? []).filter((v) => v?.url);
  const mp4 = vs
    .filter((v) => v.content_type === "video/mp4" || /\.mp4(\?|$)/.test(v.url))
    .sort((a, b) => (b.bitrate ?? b.bit_rate ?? 0) - (a.bitrate ?? a.bit_rate ?? 0))[0];
  const hls = vs.find((v) => /\.m3u8/.test(v.url));
  const best = mp4 || hls;
  if (!best) throw new Error("X: no video formats");

  let w = 0, h = 0;
  const dm = best.url.match(/\/(\d+)x(\d+)\//);
  if (dm) { w = +dm[1]; h = +dm[2]; }
  else {
    const oi = m.original_info;
    const lg = m.sizes?.large;
    w = +(oi?.width ?? lg?.w ?? 0) || 0;
    h = +(oi?.height ?? lg?.h ?? 0) || 0;
  }
  const thumb = m.media_url_https || m.media_url || null;
  return mp4 ? { url: best.url, w, h, thumb } : { url: best.url, w, h, thumb, note: "X: HLS only" };
}

async function resolveTW(url) {
  const p = twParse(url);
  if (!p) throw new Error("X: invalid link");
  let status;
  log("rvp: X tweet ID=" + p.id + (p.index ? ", video #" + p.index : "") + " -> GraphQL");
  try {
    status = await twGraphql(p.id);
    log("rvp: X GraphQL OK");
  } catch (e) {
    log("X graphql failed", e?.message ?? e);
    if (e?.fatal) throw e;
    log("rvp: X -> trying syndication");
    try { status = await twSyndication(p.id); log("rvp: X syndication OK"); }
    catch (e2) { log("X syndication failed", e2?.message ?? e2); throw e; }
  }
  return twPick(status, p.index);
}

// ---- shared: cache (success 20 min, failure only briefly) + one retry
export function resolve(link, kind) {
  const hit = cache.get(link);
  if (hit && Date.now() < hit.exp) return Promise.resolve(hit.data);
  if (pending.has(link)) {
    log("rvp: [" + kind + "] already being resolved, waiting for the result:", link);
    return pending.get(link);
  }

  const t0 = Date.now();
  const tag = "rvp: [" + kind + "]";
  log(tag, "START looking for video for:", link);
  const run = (n) => {
    log(tag, "attempt " + n);
    return kind === "fb" ? resolveFB(link) : kind === "tw" ? resolveTW(link) : resolveIG(link);
  };
  const p = run(1)
    .catch((e) => {
      if (e?.permanent) throw e;
      log(tag, "attempt 1 failed:", e?.message ?? e, "-> retrying in 0.8 s");
      return new Promise((res) => setTimeout(res, 800)).then(() => run(2));
    })
    .then(async (d) => {
      // IG: always verify dimensions from the video header; FB only when missing
      if (kind === "ig" || !(d.w && d.h)) {
        const pr = await probeDims(d.url);
        log(tag, "dimensions from video header:", pr ? pr.w + "x" + pr.h : "unknown (keeping " + d.w + "x" + d.h + ")");
        if (pr) d = { ...d, w: pr.w, h: pr.h };
      }
      log(tag, "FOUND in " + (Date.now() - t0) + " ms, dimensions " + d.w + "x" + d.h + (d.note ? ", note: " + d.note : ""));
      log(tag, "VIDEO URL:", d.url);
      log(tag, "THUMBNAIL:", d.thumb ?? "none");
      cache.set(link, { exp: expFor(d.url, kind), data: d });
      persistSoon();
      return d;
    })
    .catch((e) => {
      log(tag, "NOT FOUND after " + (Date.now() - t0) + " ms, reason:", e?.message ?? e, "| link:", link);
      cache.set(link, { exp: Date.now() + (e?.permanent ? TTL : NEG_TTL), data: null });
      return null;
    })
    .finally(() => pending.delete(link));
  pending.set(link, p);
  return p;
}

// Settings page helpers -------------------------------------------------
// How many videos are remembered right now (in memory / saved in this plugin's storage)
export function cacheInfo() {
  let saved = 0;
  try { saved = Object.keys(store()?.vcache ?? {}).length; } catch {}
  return { memory: cache.size, saved };
}

// Deletes everything THIS plugin stored (the saved video cache) and empties its in-memory cache. Touches nothing else.
export function wipePluginData() {
  const before = cacheInfo();
  clearCache();   // also cancels a pending delayed save, so it can't write the old data back
  const st = store();
  let removed = 0;
  if (st) {
    for (const k of Object.keys(st)) {
      try { delete st[k]; removed++; } catch (e) { log("rvp: could not delete storage key", k, e?.message ?? e); }
    }
  }
  log("rvp: plugin data cleared (memory entries: " + before.memory + ", saved entries: " + before.saved + ", storage keys removed: " + removed + ")");
  return before;
}

export function clearCache() {
  clearTimeout(saveTimer);   // so a delayed write doesn't overwrite saved data with an empty cache
  cache.clear();
  pending.clear();
}
