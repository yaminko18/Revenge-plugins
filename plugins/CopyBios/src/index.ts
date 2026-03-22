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

      // Embedy — nahraď content len keď je prázdny alebo samotný URL
      if (embedNodes.length > 0) {
        const isEmpty = !e.content || e.content.length === 0;
        const isJustUrl = !isEmpty && contentIsJustUrl(e.content, embedNodes[0].target);

        if (isEmpty || isJustUrl) {
          e.content = embedNodes.flatMap((node: any, i: number) =>
            i < embedNodes.length - 1
              ? [node, { type: "text", content: "\n" }]
              : [node]
          );
        }
      }

      // Attachmenty — vždy pripoj názov na koniec
      if (attachmentNodes.length > 0) {
        if (!e.content) e.content = [];
        if (e.content.length > 0)
          e.content.push({ type: "text", content: "\n" });
        e.content.push(...attachmentNodes.flatMap((node: any, i: number) =>
          i < attachmentNodes.length - 1
            ? [node, { type: "text", content: "\n" }]
            : [node]
        ));
      }
    });
  };

  const i = function() { a?.(); };
  return o.onLoad = l, o.onUnload = i, o;
})({}, vendetta.metro, vendetta.patcher);
Zmeny oproti predchádzajúcej verzii:
Embedy a attachmenty sú teraz spracované oddelene
Attachmenty sa vždy pripoja na koniec, bez ohľadu na to či správa má text alebo nie
