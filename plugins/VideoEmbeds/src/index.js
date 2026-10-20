// index.js – napojenie na Discord: pri správe s videolinkom pridá video prílohu (prehrávač).
// Jednoduchý tok podľa pôvodnej fungujúcej verzie: nájdi video -> jeden MESSAGE_UPDATE.
import { FB_RE, IG_RE, TW_RE, MARK } from "./helpers.js";
import { resolve, cache, clearCache } from "./resolvers.js";

const { patcher, metro, logger } = vendetta;
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
function process(msg) {
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
  logger.log("rvp: hladam", found.kind, msg.id);
  resolve(found.link, found.kind).then((d) => {
    if (!d || !channel_id) { logger.log("rvp: nenaslo", found.kind, msg.id); return; }
    logger.log("rvp: update", msg.id);
    FluxDispatcher.dispatch({
      type: "MESSAGE_UPDATE",
      message: { id: msg.id, channel_id, attachments: [...base, makeAtt(msg.id, d)] },
    });
  });
}

let unpatch;
export default {
  onLoad() {
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
            ev.messages?.forEach(process);
            break;
        }
      } catch (e) { logger.log("patch error", e); }
    });
  },
  onUnload() {
    unpatch?.();
    clearCache();
  },
};
