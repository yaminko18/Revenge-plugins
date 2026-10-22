// index.js – Discord hook: when a message contains a video link, attach a video (player) to it.
// Simple flow based on the original working version: find video -> a single MESSAGE_UPDATE.
import { log, FB_RE, IG_RE, TW_RE, MARK, EMBED_MODE } from "./helpers.js";
import { resolve, cache, clearCache, loadCache } from "./resolvers.js";

const { patcher, metro } = vendetta;
const FluxDispatcher =
  metro.common?.FluxDispatcher ?? metro.findByProps("dispatch", "subscribe");

// Builds a fake video attachment so Discord renders its native player
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

// Builds a fake video embed (with thumbnail) so Discord shows a preview image with the video
const makeEmbed = (msgId, link, d) => ({
  id: MARK + msgId,
  type: "video",
  url: link,
  thumbnail: { url: d.thumb, proxy_url: d.thumb, width: d.w || 640, height: d.h || 360 },
  video: { url: d.url, proxy_url: d.url, width: d.w || 640, height: d.h || 360 },
});

// Returns the message fields to change: a video embed when we have a thumbnail, otherwise the plain video attachment
function videoFields(msgId, link, d, atts, embs) {
  if (EMBED_MODE && d.thumb) return { embeds: [...embs, makeEmbed(msgId, link, d)] };
  return { attachments: [...atts, makeAtt(msgId, d)] };
}

// True if the message already has our attachment/embed or any real video attachment
const hasVideo = (msg) =>
  (msg.attachments ?? []).some(
    (a) => String(a.id).startsWith(MARK) || String(a.content_type ?? "").startsWith("video/")
  ) || (msg.embeds ?? []).some((e) => String(e?.id ?? "").startsWith(MARK));

// Finds the first supported link (Facebook / Instagram / X) in the message text
function detect(content) {
  let m;
  if ((m = content.match(FB_RE))) return { link: m[0], kind: "fb" };
  if ((m = content.match(IG_RE))) return { link: m[0], kind: "ig" };
  if ((m = content.match(TW_RE))) return { link: m[0], kind: "tw" };
  return null;
}

// Modifies the message in the payload (cache hit) or dispatches MESSAGE_UPDATE once the video is found
function process(msg, src = "") {
  const load = /^LOAD_MESSAGES/.test(src);
  if (!msg || typeof msg.content !== "string" || !msg.content || !msg.id) return;
  if (hasVideo(msg)) return;
  const found = detect(msg.content);
  if (!found) return;

  log("rvp: MESSAGE", msg.id, "| source:", src, "| type:", found.kind, "| link:", found.link);
  const hit = cache.get(found.link);
  if (hit && Date.now() < hit.exp) {
    if (hit.data) {
      log("rvp:   from cache -> adding to payload (before render), URL:", hit.data.url);
      Object.assign(msg, videoFields(msg.id, found.link, hit.data, msg.attachments ?? [], msg.embeds ?? []));
    } else {
      log("rvp:   from cache: previously FAILED (will retry after the short negative cache expires)");
    }
    return;
  }

  const base = msg.attachments ?? [];
  const baseEmbeds = msg.embeds ?? [];
  const channel_id = msg.channel_id;
  log("rvp:   not in cache -> looking for video");
  resolve(found.link, found.kind).then((d) => {
    if (!d || !channel_id) { log("rvp:   message", msg.id, "stays WITHOUT video"); return; }
    const go = () => {
      log("rvp:   MESSAGE_UPDATE for message", msg.id, "| video URL:", d.url, "| dimensions:", d.w + "x" + d.h);
      FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        message: { id: msg.id, channel_id, ...videoFields(msg.id, found.link, d, base, baseEmbeds) },
      });
    };
    if (load && isNewestLinked(msg.id, channel_id)) {
      log("rvp:   newest message with a video -> adding after " + LAST_DELAY + " ms");
      setTimeout(go, LAST_DELAY);
    } else go();
  });
}

// Messages already in MessageStore (returning to a channel, channel open at app start)
// don't go through dispatch – Discord sends no event for them. We walk through them ourselves.
const MessageStore = (() => {
  try { return metro.findByStoreName("MessageStore"); } catch { return null; }
})();
const SelectedChannelStore = (() => {
  try { return metro.findByStoreName("SelectedChannelStore"); } catch { return null; }
})();

// The latest (newest) video in a channel is added with a small delay after the others.
const LAST_DELAY = 800;
// True if no newer message with a supported link exists in the channel (snowflake IDs compared by length, then lexically)
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

// Adds the video to a message if it is in the store, has no video yet and still contains the same link. One dispatch.
function attach(id, channel_id, link, d) {
  const cur = MessageStore?.getMessage?.(channel_id, id);
  if (!cur) { log("rvp:   scan: message", id, "is no longer in the store, skipping"); return; }
  if (hasVideo(cur)) return;   // already has a player
  if (typeof cur.content !== "string" || detect(cur.content)?.link !== link) {
    log("rvp:   scan: message", id, "now has a different link/text, skipping");
    return;
  }
  log("rvp:   MESSAGE_UPDATE (scan) for message", id, "| link:", link, "| video URL:", d.url, "| dimensions:", d.w + "x" + d.h);
  FluxDispatcher.dispatch({
    type: "MESSAGE_UPDATE",
    message: { id, channel_id, ...videoFields(id, link, d, Array.from(cur.attachments ?? []), Array.from(cur.embeds ?? [])) },
  });
}

// Goes through all messages of a channel already in the store and attaches videos where needed
function scanChannel(channelId) {
  if (!channelId || !MessageStore?.getMessages) return;
  try {
    const col = MessageStore.getMessages(channelId);
    const arr = col?._array ?? col?.toArray?.() ?? [];
    let todo = 0;
    for (const m of arr) {
      if (!m?.id || typeof m.content !== "string" || !m.content || hasVideo(m)) continue;
      const found = detect(m.content);
      if (!found) continue;
      todo++;
      const id = m.id, cid = m.channel_id ?? channelId;
      log("rvp: SCAN message", id, "| type:", found.kind, "| link:", found.link);
      const hit = cache.get(found.link);
      if (hit && Date.now() < hit.exp) {
        if (hit.data) attach(id, cid, found.link, hit.data);   // immediately, before render (no late jump)
        else log("rvp:   from cache: previously FAILED");
        continue;
      }
      log("rvp:   not in cache -> looking for video");
      resolve(found.link, found.kind).then((d) => {
        if (d) attachSoon(id, cid, found.link, d);
        else log("rvp:   message", id, "stays WITHOUT video");
      });
    }
    if (todo) log("rvp: SCAN of channel " + channelId + ": " + todo + " messages with a video link and no player (out of " + arr.length + " in store)");
  } catch (e) { log("scan error", e); }
}

// ---- PROBE (temporary): finds out which components render a message row, so the video
// could be added at render time. We'll remove it once we know.
const PROBE = true;
function probeUI() {
  const t = (f) => { try { return f(); } catch (e) { return "error: " + (e?.message ?? e); } };
  const show = (name, m) => {
    if (!m) return log("rvp: PROBE", name, "-> not found");
    const keys = t(() => Object.keys(m).slice(0, 12).join(","));
    log("rvp: PROBE", name, "-> FOUND | type:", typeof m, "| default:", typeof m?.default, "| keys:", keys);
  };
  for (const n of ["Message", "ChatMessage", "MessageContent", "MessageAccessories", "MessageRow",
                   "MessageAttachments", "Attachment", "MessagesList", "ChannelMessages"]) {
    show("name:" + n, t(() => metro.findByName?.(n, false)));
  }
  for (const props of [["renderMessage"], ["MessageAccessories"], ["MessageContent"], ["renderAttachments"],
                       ["onViewableItemsChanged"], ["renderRow"]]) {
    show("props:" + props.join("+"), t(() => metro.findByProps?.(...props)));
  }
  for (const n of ["Message", "ChatMessage", "MessageContent", "MessageAccessories"]) {
    show("displayName:" + n, t(() => metro.findByDisplayName?.(n, false)));
  }
}

let unpatch;
export default {
  onLoad() {
    if (PROBE) setTimeout(probeUI, 3000);
    log("rvp: plugin loaded");
    loadCache();   // videos found in previous runs, saved in storage
    // after start: current channel (the store may fill up gradually)
    for (const t of [500, 3000]) setTimeout(() => scanChannel(SelectedChannelStore?.getChannelId?.()), t);
    unpatch = patcher.before("dispatch", FluxDispatcher, (args) => {
      const ev = args[0];
      if (!ev) return;
      try {
        switch (ev.type) {
          case "MESSAGE_CREATE":
          case "MESSAGE_UPDATE":
            process(ev.message, ev.type);
            break;
          case "LOAD_MESSAGES_SUCCESS":
          case "LOAD_MESSAGES_SUCCESS_CACHED":   // channel loaded from cache (without this the messages wouldn't be processed)
            ev.messages?.forEach((m) => process(m, ev.type));
            break;
          default:
            // other events carrying loaded messages (e.g. loading around a message)
            if (/^LOAD_MESSAGES/.test(ev.type) && Array.isArray(ev.messages))
              ev.messages.forEach((m) => process(m, ev.type));
            break;
          case "CHANNEL_SELECT":
            // returning to a channel: messages are already in the store and nothing is dispatched
            scanChannel(ev.channelId);                       // immediately (cache -> before render)
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
