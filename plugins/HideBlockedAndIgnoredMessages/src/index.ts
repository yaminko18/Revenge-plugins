import { FluxDispatcher } from "@vendetta/metro/common";
import { before, after } from "@vendetta/patcher";
import { findByProps, findByName, findByStoreName } from "@vendetta/metro";
import { logger } from "@vendetta";
import { storage } from "@vendetta/plugin";
import Settings from "./settings";

const RowManager = findByName("RowManager");
const { isBlocked, isIgnored } = findByProps("isBlocked", "isIgnored");

const pluginName = "HideBlockedAndIgnoredMessages";

// Discord message types
const MESSAGE_TYPE_DEFAULT = 0;
const MESSAGE_TYPE_REPLY = 19;

function constructMessage(message, channel) {
    let msg = {
        id: "",
        type: 0,
        content: "",
        channel_id: channel.id,
        author: {
            id: "",
            username: "",
            avatar: "",
            discriminator: "",
            publicFlags: 0,
            avatarDecoration: null,
        },
        attachments: [],
        embeds: [],
        mentions: [],
        mention_roles: [],
        pinned: false,
        mention_everyone: false,
        tts: false,
        timestamp: "",
        edited_timestamp: null,
        flags: 0,
        components: [],
    };

    if (typeof message === "string") msg.content = message;
    else msg = { ...msg, ...message };

    return msg;
}

// ---------- Filtering logic ----------

const isFilteredUser = (id) => {
    if (!id) return false;
    if (storage.blocked && isBlocked(id)) return true;
    if (storage.ignored && isIgnored(id)) return true;
    return false;
};

// Message is hidden completely (same logic as the original plugin)
const shouldHide = (msg) => {
    if (!msg) return false;
    if (isFilteredUser(msg.author?.id)) return true;

    // "Convert" has priority over "remove"
    if (storage.removeReplies && !storage.convertReplies && msg.referenced_message) {
        if (isFilteredUser(msg.referenced_message.author?.id)) return true;
    }

    return false;
};

// Ids of filtered-author messages we dropped ourselves. Such messages are no longer
// in the message store, so replies pointing to them can only be recognised by id.
const droppedIds = new Set();
const rememberDropped = (msg) => {
    const id = msg?.id;
    if (!id || !isFilteredUser(msg.author?.id)) return;
    droppedIds.add(id);
    if (droppedIds.size > 2000) droppedIds.delete(droppedIds.values().next().value);
};

// Id of the message a reply points to
const getRefId = (msg) =>
    msg.messageReference?.message_id ??
    msg.message_reference?.message_id ??
    msg.referenced_message?.id ??
    msg.referencedMessage?.message?.id;

// Author id of the message a reply points to.
// Raw payloads carry it directly; cached records may only hold a reference,
// so fall back to looking the referenced message up in the message store.
let messageStore = null;
const getRefAuthorId = (msg) => {
    const direct =
        msg.referenced_message?.author?.id ??
        msg.referencedMessage?.message?.author?.id;
    if (direct) return direct;

    try {
        const ref = msg.messageReference ?? msg.message_reference;
        const refId = ref?.message_id;
        if (!refId) return undefined;
        const channelId = ref.channel_id ?? msg.channel_id ?? msg.channelId;
        messageStore ??= findByStoreName("MessageStore");
        return messageStore?.getMessage?.(channelId, refId)?.author?.id;
    } catch (e) {
        return undefined;
    }
};

// Message is shown, but as a normal (non-reply) message.
// Cheap checks first: only real replies are ever inspected.
const shouldConvert = (msg) => {
    if (!msg || !storage.convertReplies) return false;
    if (msg.type !== MESSAGE_TYPE_REPLY) return false;
    if (isFilteredUser(msg.author?.id)) return false; // hidden anyway
    if (isFilteredUser(getRefAuthorId(msg))) return true;

    const refId = getRefId(msg);
    return !!refId && droppedIds.has(refId);
};

// ---------- Reply -> normal message ----------

const trySet = (obj, key, value) => {
    try {
        obj[key] = value;
    } catch (e) {}
};

const convertToNormalMessage = (msg) => {
    trySet(msg, "type", MESSAGE_TYPE_DEFAULT);
    trySet(msg, "referenced_message", null);
    trySet(msg, "referencedMessage", null);
    trySet(msg, "message_reference", null);
    trySet(msg, "messageReference", null);
};

// For render: a converted copy, created once per message object and then reused
const copies = new WeakMap();

const convertedCopy = (msg) => {
    const cached = copies.get(msg);
    if (cached) return cached;

    let copy;
    try {
        copy = typeof msg.merge === "function"
            ? msg.merge({ type: MESSAGE_TYPE_DEFAULT, messageReference: null, referencedMessage: null })
            : Object.assign(Object.create(Object.getPrototypeOf(msg)), msg);
        convertToNormalMessage(copy);
    } catch (e) {
        logger.error(`[${pluginName}] copy failed:`, e);
        return msg;
    }

    copies.set(msg, copy);
    return copy;
};

// ---------- Sweep of cached messages (after start and on channel switch) ----------

const REFRESH_DELAY_MS = 2000;
const CHANNEL_SWEEP_DELAY_MS = 600;
let refreshTimer = null;
let sweepTimer = null;

// Goes through cached messages of the open channel:
// - replies to filtered users get a real change, so their rows are rendered again
// - filtered standalone messages already in the store are rendered again (and hidden by the render patch)
const sweepMessages = (reason) => {
    let info = "";
    let converted = 0;
    let hidden = 0;
    try {
        const MessageStore = findByStoreName("MessageStore");
        const SelectedChannelStore = findByStoreName("SelectedChannelStore");
        const channelId = SelectedChannelStore?.getChannelId?.();

        const collection = channelId ? MessageStore?.getMessages?.(channelId) : null;
        const messages = collection?.toArray?.() ?? collection?._array ?? [];

        let replies = 0;
        let resolved = 0;
        let viaDropped = 0;
        for (const msg of messages) {
            if (msg.type === MESSAGE_TYPE_REPLY) {
                replies++;
                if (getRefAuthorId(msg)) resolved++;
                else if (droppedIds.has(getRefId(msg))) viaDropped++;
            }

            if (shouldConvert(msg)) {
                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    message: {
                        id: msg.id,
                        channel_id: channelId,
                        type: MESSAGE_TYPE_DEFAULT,
                        message_reference: null,
                        referenced_message: null,
                    },
                    __hbiRefresh: true, // our dispatch patch lets this one through untouched
                });
                converted++;
            } else if (shouldHide(msg)) {
                rememberDropped(msg);
                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    message: { id: msg.id, channel_id: channelId },
                    __hbiRefresh: true, // our dispatch patch lets this one through untouched
                });
                hidden++;
            }
        }

        info = `channel=${!!channelId} store=${!!MessageStore} msgs=${messages.length} replies=${replies} resolved=${resolved} viaDropped=${viaDropped} dropped=${droppedIds.size} converted=${converted} hidden=${hidden}`;
    } catch (err) {
        info = `ERROR ${err?.message ?? err}`;
        logger.error(`[${pluginName}] Sweep (${reason}) failed:`, err);
    }

    // Startup always reports, later sweeps only when they changed something
    if (reason === "startup" || converted + hidden > 0) {
        console.log(`[${pluginName}] Sweep (${reason}): ${info}`);
    }
};

const scheduleChannelSweep = () => {
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => {
        sweepTimer = null;
        sweepMessages("channel");
    }, CHANNEL_SWEEP_DELAY_MS);
};

// ---------- TEMP DIAGNOSTICS: how Discord builds the "blocked messages" rows ----------

let rowsDebugCount = 0;
const describeValue = (v) => {
    try {
        if (v == null) return String(v);
        if (Array.isArray(v)) return `array(${v.length})`;
        if (typeof v === "object") return `object{${Object.keys(v).slice(0, 15).join(",")}}`;
        return typeof v;
    } catch (e) {
        return "?";
    }
};

const debugBuiltRows = (args, res) => {
    if (rowsDebugCount >= 8) return;
    try {
        const rows = Array.isArray(res) ? res : [];
        const isBlockRow = (r) => {
            try { return /block|ignor/i.test(String(r?.type) + Object.keys(r ?? {}).join(",")); }
            catch (e) { return false; }
        };
        const blockRows = rows.filter(isBlockRow);

        // Always describe the first calls; afterwards only calls that built a block/ignore row
        if (rowsDebugCount >= 2 && blockRows.length === 0) return;
        rowsDebugCount++;

        const types = [...new Set(rows.map((r) => String(r?.type ?? r?.rowType)))].slice(0, 12).join(",");
        const sample = blockRows.slice(0, 2).map((r) => `${String(r?.type)}{${Object.keys(r).slice(0, 12).join("/")}}`).join(" ; ");
        console.log(
            `[${pluginName}][ROWS] args=[${args.map(describeValue).join(" | ")}] result=${describeValue(res)} types=${types} blockRows=${blockRows.length} ${sample}`
        );
    } catch (e) {}
};

// ---------- Patches ----------

let patches = [];

const startPlugin = () => {
    try {
        const patch1 = before("dispatch", FluxDispatcher, ([event]) => {
            try {
                if (!event || event.__hbiRefresh) return;

                if (event.type === "LOAD_MESSAGES_SUCCESS") {
                    event.messages = (event.messages ?? []).filter((msg) => {
                        if (!shouldHide(msg)) return true;
                        rememberDropped(msg);
                        return false;
                    });
                    for (const msg of event.messages) {
                        if (shouldConvert(msg)) convertToNormalMessage(msg);
                    }
                }

                if (event.type === "CHANNEL_SELECT") scheduleChannelSweep();

                if (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") {
                    // Partial updates carry no author, so also match by remembered id
                    if (shouldHide(event.message) || droppedIds.has(event.message?.id)) {
                        rememberDropped(event.message);
                        event.channelId = "0"; // Drop it
                    } else if (shouldConvert(event.message)) {
                        convertToNormalMessage(event.message);
                    }
                }
            } catch (err) {
                logger.error(`[${pluginName}] dispatch patch error:`, err);
            }
        });
        patches.push(patch1);

        const patch2 = before("generate", RowManager.prototype, ([data]) => {
            try {
                if (!data) return;

                if (shouldHide(data.message)) {
                    data.renderContentOnly = true;
                    data.message.content = null;
                    data.message.reactions = [];
                    data.message.canShowComponents = false;
                    if (data.rowType === 2) {
                        data.roleStyle = "";
                        data.text = "[Filtered message. Check plugin settings.]";
                        data.revealed = false;
                        data.content = [];
                    }
                } else if (shouldConvert(data.message)) {
                    data.message = convertedCopy(data.message);
                }
            } catch (err) {
                logger.error(`[${pluginName}] render patch error:`, err);
            }
        });
        patches.push(patch2);

        // TEMP DIAGNOSTICS (does not change behaviour)
        try {
            const ChannelMessagesModule = findByProps("flatMapChannelMessages");
            if (ChannelMessagesModule) {
                patches.push(after("flatMapChannelMessages", ChannelMessagesModule, (args, res) => {
                    debugBuiltRows(args, res);
                }));
            } else {
                console.log(`[${pluginName}][ROWS] flatMapChannelMessages not found`);
            }
        } catch (err) {
            console.log(`[${pluginName}][ROWS] patch failed: ${err?.message ?? err}`);
        }

        logger.log(`${pluginName} loaded.`);
    } catch (err) {
        logger.error(`[${pluginName} Error]`, err);
    }
};

export default {
    onLoad: () => {
        logger.log(`Loading ${pluginName}...`);

        storage.blocked ??= true;
        storage.ignored ??= true;
        storage.removeReplies ??= true;
        storage.convertReplies ??= false;

        // Dispatch dummy messages
        for (let type of ["MESSAGE_CREATE", "MESSAGE_UPDATE", "LOAD_MESSAGES", "LOAD_MESSAGES_SUCCESS"]) {
            logger.log(`Dispatching ${type} to enable handler.`);
            FluxDispatcher.dispatch({
                type,
                message: constructMessage("PLACEHOLDER", { id: "0" }),
                messages: [],
            });
        }

        startPlugin();

        // One-time check shortly after start
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            sweepMessages("startup");
        }, REFRESH_DELAY_MS);
    },

    onUnload: () => {
        logger.log(`Unloading ${pluginName}...`);
        if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
        if (sweepTimer) {
            clearTimeout(sweepTimer);
            sweepTimer = null;
        }
        for (let unpatch of patches) unpatch();
        patches = [];
        logger.log(`${pluginName} unloaded.`);
    },

    settings: Settings,
};
