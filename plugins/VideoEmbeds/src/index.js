// index.js – napojenie na Discord: pri správe s videolinkom pridá video prílohu (prehrávač).
// Jednoduchý tok podľa pôvodnej fungujúcej verzie: nájdi video -> jeden MESSAGE_UPDATE.
import { log, FB_RE, IG_RE, TW_RE, MARK } from "./helpers.js";
import { resolve, cache, clearCache } from "./resolvers.js";

const { patcher, metro } = vendetta;
const FluxDispatcher =
  metro.common?.FluxDispatcher ?? metro.findByProps("dispatch", "subscribe");

const makeAtt = (msgId, d) => ({
  id: MARK + msgId,
  filename: "video.mp4",
  content_type: "video/mp4",
  url: d.url,
  proxy_url: d.url,
  width: d.w || 640,
  height: d.h || 360,
  size: 0,
});

const tail = (d) => String(d?.url ?? "").slice(0, 40) + "…" + String(d?.url ?? "").slice(-28);

const hasVideo = (msg) =>
  (msg.attachments ?? []).some(
    (a) => String(a.id).startsWith(MARK) || String(a.content_type ?? "").startsWith("video/")
  );

function detect(content) {
  let m;
  if ((m = content.match(FB_RE))) return { link: m[0], kind: "fb" };
  if ((m = content.match(IG_RE))) return { link: m[0], kind: "ig" };
  if ((m = content.match(TW_RE))) return { link: m[0], kind: "tw" };
  return null;
}

// upraví správu v payloade (cache) alebo po nájdení videa pošle MESSAGE_UPDATE
function process(msg, load = false) {
  if (!msg || typeof msg.content !== "string" || !msg.content || !msg.id) return;
  if (hasVideo(msg)) return;
  const found = detect(msg.content);
  if (!found) return;

  const hit = cache.get(found.link);
  if (hit && Date.now() < hit.exp) {
    if (hit.data) msg.attachments = [...(msg.attachments ?? []), makeAtt(msg.id, hit.data)];
    return;
  }

  const base = msg.attachments ?? [];
  const channel_id = msg.channel_id;
  log("rvp: hladam", found.kind, msg.id);
  resolve(found.link, found.kind).then((d) => {
    if (!d || !channel_id) { log("rvp: nenaslo", found.kind, msg.id); return; }
    const go = () => {
      log("rvp: update", msg.id, "link:", found.link, "url:", tail(d));
      FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        message: { id: msg.id, channel_id, attachments: [...base, makeAtt(msg.id, d)] },
      });
    };
    if (load && isNewestLinked(msg.id, channel_id)) setTimeout(go, LAST_DELAY); else go();
  });
}

// Správy, ktoré sú už v MessageStore (návrat do kanála, kanál otvorený pri štarte appky),
// neprejdú cez dispatch – Discord pre ne neposiela žiadnu udalosť. Prejdeme ich sami.
const MessageStore = (() => {
  try { return metro.findByStoreName("MessageStore"); } catch { return null; }
})();
const SelectedChannelStore = (() => {
  try { return metro.findByStoreName("SelectedChannelStore"); } catch { return null; }
})();

// Posledné (najnovšie) video v kanáli sa pridáva s malým oneskorením po ostatných.
const LAST_DELAY = 800;
function isNewestLinked(id, channel_id) {
  try {
    const col = MessageStore?.getMessages?.(channel_id);
    const arr = col?._array ?? col?.toArray?.() ?? [];
    const gt = (a, b) => String(a).length - String(b).length || (String(a) > String(b) ? 1 : -1);
    for (const m of arr)
      if (m?.id && m.id !== id && gt(m.id, id) > 0 && typeof m.content === "string" && detect(m.content)) return false;
  } catch {}
  return true;
}
const attachSoon = (id, cid, link, d) =>
  isNewestLinked(id, cid) ? setTimeout(() => attach(id, cid, link, d), LAST_DELAY) : attach(id, cid, link, d);

// Pridá video správe, ak je v store, nemá video a stále obsahuje ten istý odkaz. Jeden dispatch.
function attach(id, channel_id, link, d) {
  const cur = MessageStore?.getMessage?.(channel_id, id);
  if (!cur || hasVideo(cur)) return;
  if (typeof cur.content !== "string" || detect(cur.content)?.link !== link) return;
  log("rvp: update (scan)", id, "link:", link, "url:", tail(d));
  FluxDispatcher.dispatch({
    type: "MESSAGE_UPDATE",
    message: { id, channel_id, attachments: [...Array.from(cur.attachments ?? []), makeAtt(id, d)] },
  });
}

function scanChannel(channelId) {
  if (!channelId || !MessageStore?.getMessages) return;
  try {
    const col = MessageStore.getMessages(channelId);
    const arr = col?._array ?? col?.toArray?.() ?? [];
    for (const m of arr) {
      if (!m?.id || typeof m.content !== "string" || !m.content || hasVideo(m)) continue;
      const found = detect(m.content);
      if (!found) continue;
      const id = m.id, cid = m.channel_id ?? channelId;
      const hit = cache.get(found.link);
      if (hit && Date.now() < hit.exp) {
        if (hit.data) attach(id, cid, found.link, hit.data);   // hneď, pred vykreslením (bez neskorého skoku)
        continue;
      }
      resolve(found.link, found.kind).then((d) => { if (d) attachSoon(id, cid, found.link, d); });
    }
  } catch (e) { log("scan error", e); }
}

let unpatch;
export default {
  onLoad() {
    log("rvp: plugin nacitany");
    // po štarte: aktuálny kanál (store sa môže plniť postupne)
    for (const t of [500, 3000]) setTimeout(() => scanChannel(SelectedChannelStore?.getChannelId?.()), t);
    unpatch = patcher.before("dispatch", FluxDispatcher, (args) => {
      const ev = args[0];
      if (!ev) return;
      try {
        switch (ev.type) {
          case "MESSAGE_CREATE":
          case "MESSAGE_UPDATE":
            process(ev.message);
            break;
          case "LOAD_MESSAGES_SUCCESS":
          case "LOAD_MESSAGES_SUCCESS_CACHED":   // kanál načítaný z cache (bez tohto sa správy nespracujú)
            ev.messages?.forEach((m) => process(m, true));
            break;
          default:
            // iné udalosti s načítanými správami (napr. načítanie okolo správy)
            if (/^LOAD_MESSAGES/.test(ev.type) && Array.isArray(ev.messages))
              ev.messages.forEach((m) => process(m, true));
            break;
          case "CHANNEL_SELECT":
            // návrat do kanála: správy sú v store a nič sa nedispatchuje
            scanChannel(ev.channelId);                       // hneď (cache -> pred vykreslením)
            break;
        }
      } catch (e) { log("patch error", e); }
    });
  },
  onUnload() {
    unpatch?.();
    clearCache();
  },
};
