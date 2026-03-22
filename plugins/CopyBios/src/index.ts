(function(o, u, f) {
  "use strict";
  const p = u.findByName("RowManager");
  let a;

  const getFilename = (url) => {
    try {
      const path = new URL(url).pathname;
      return decodeURIComponent(path.split("/").pop()) || url;
    } catch {
      return url;
    }
  };

  const l = function() {
    a = f.after("generate", p.prototype, function(d, g) {
      let [h] = d, { message: e } = g;
      if (h.rowType !== 1 || !e?.embeds) return;

      const imageUrls = e.embeds
        .filter(t => t.type === "image" || t.type === "gifv")
        .map(t => t.url)
        .filter(Boolean);

      if (imageUrls.length === 0) return;

      if (!e.content || e.content.length === 0) {
        const nodes = [];
        imageUrls.forEach((url, i) => {
          nodes.push({
            type: "link",
            content: [{ type: "text", content: getFilename(url) }],
            target: url
          });
          if (i < imageUrls.length - 1)
            nodes.push({ type: "text", content: "\n" });
        });
        e.content = nodes;
      }
    });
  };

  const i = function() { a?.(); };
  return o.onLoad = l, o.onUnload = i, o;
})({}, vendetta.metro, vendetta.patcher);
