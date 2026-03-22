(function(o, u, f) {
  "use strict";
  const p = u.findByName("RowManager");
  let a;

  const getFilename = (url: string): string => {
    try {
      const path = new URL(url).pathname;
      return decodeURIComponent(path.split("/").pop()) || url;
    } catch {
      return url;
    }
  };

  const contentIsJustUrl = (content: any[], url: string): boolean => {
    if (content.length !== 1) return false;
    const node = content[0];
    if (node.type === "text" && node.content?.trim() === url) return true;
    if (node.type === "link" && node.target?.trim() === url) return true;
    return false;
  };

  const l = function() {
    a = f.after("generate", p.prototype, function(d: any, g: any) {
      let [h] = d, { message: e } = g;
      if (h.rowType !== 1 || (!e?.embeds && !e?.attachments)) return;

      const embedNodes: any[] = (e.embeds ?? [])
        .filter((t: any) => t.type === "image" || t.type === "gifv")
        .filter((t: any) => t.url)
        .map((t: any) => ({
          type: "link",
          content: [{ type: "text", content: getFilename(t.url) }],
          target: t.url
        }));

      const attachmentNodes: any[] = (e.attachments ?? [])
        .filter((t: any) => t.content_type?.startsWith("image/"))
        .filter((t: any) => t.url)
        .map((t: any) => ({
          type: "text",
          content: t.filename ?? getFilename(t.url)
        }));

      const allNodes = [...embedNodes, ...attachmentNodes];
      if (allNodes.length === 0) return;

      const isEmpty = !e.content || e.content.length === 0;

      const firstUrl = embedNodes[0]?.target ?? (e.attachments ?? [])
        .find((t: any) => t.content_type?.startsWith("image/"))?.url;

      const isJustUrl = !isEmpty && !!firstUrl && contentIsJustUrl(e.content, firstUrl);

      if (isEmpty || isJustUrl) {
        e.content = allNodes.flatMap((node: any, i: number) =>
          i < allNodes.length - 1
            ? [node, { type: "text", content: "\n" }]
            : [node]
        );
      }
    });
  };

  const i = function() { a?.(); };
  return o.onLoad = l, o.onUnload = i, o;
})({}, vendetta.metro, vendetta.patcher);
