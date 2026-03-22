const RowManager = vendetta.metro.findByName("RowManager");
const MessageStore = vendetta.metro.findByProps("getMessage", "getMessages");
let unpatch: (() => void) | undefined;

const getFilename = (url: string): string => {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").pop()) || url;
  } catch {
    return url;
  }
};

export function onLoad() {
  unpatch = vendetta.patcher.after("generate", RowManager.prototype, function(d: any, g: any) {
    let [h] = d, { message: e } = g;
    if (h.rowType !== 1 || !e?.content) return;

    const fullMessage = MessageStore?.getMessage(e.channel_id, e.id) ?? e;

    let r = 0;
    const n: string[] = [];
    for (const t of (fullMessage.embeds ?? []))
      (t.type == "image" || t.type == "gifv") && (r++, n.push(t.url));

    const c: any[] = [];
    for (let t = 0; t < n.length; t++) {
      const s = n[t];
      c.push({ type: "link", content: [{ type: "text", content: s }], target: s });
      if (t < n.length - 1) c.push({ type: "text", content: "\n" });
    }

    if (e.content.length == 0 && r > 0) e.content.push(...c);

    const attachmentNodes: any[] = (fullMessage.attachments ?? [])
      .filter((t: any) => t.content_type?.startsWith("image/"))
      .filter((t: any) => t.url)
      .map((t: any) => ({ type: "text", content: t.filename ?? getFilename(t.url) }));

    if (attachmentNodes.length > 0) {
      if (e.content.length > 0)
        e.content.push({ type: "text", content: "\n" });
      e.content.push(...attachmentNodes.flatMap((node: any, i: number) =>
        i < attachmentNodes.length - 1
          ? [node, { type: "text", content: "\n" }]
          : [node]
      ));
    }
  });
}

export function onUnload() {
  unpatch?.();
}
