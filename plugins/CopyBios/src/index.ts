(function(o, u, f) {
    "use strict";
    const p = u.findByName("RowManager");
    let a;

    const l = function() {
        a = f.after("generate", p.prototype, function(d, g) {
            let [h] = d;
            let { message: e } = g;

            if (h.rowType !== 1 || !e?.content) return;
            if (!e.embeds?.length && !e.attachments?.length) return;

            const nodes = [];

            if (e.embeds?.length) {
                const urls = [];
                for (const embed of e.embeds)
                    if (embed.type === "image" || embed.type === "gifv")
                        urls.push(embed.url);

                for (let i = 0; i < urls.length; i++) {
                    nodes.push({
                        type: "link",
                        content: [{ type: "text", content: urls[i] }],
                        target: urls[i]
                    });
                    if (i < urls.length - 1)
                        nodes.push({ type: "text", content: "\n" });
                }
            }

            if (e.attachments?.length) {
                if (nodes.length > 0)
                    nodes.push({ type: "text", content: "\n" });

                for (let i = 0; i < e.attachments.length; i++) {
                    nodes.push({ type: "text", content: e.attachments[i].filename });
                    if (i < e.attachments.length - 1)
                        nodes.push({ type: "text", content: "\n" });
                }
            }

            if (nodes.length > 0)
                e.content.push(...nodes);
        });
    };

    const i = function() { a?.(); };
    return o.onLoad = l, o.onUnload = i, o;
})({}, vendetta.metro, vendetta.patcher);
