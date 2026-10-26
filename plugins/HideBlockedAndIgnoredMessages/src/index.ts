import { FluxDispatcher } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { findByProps, findByName, findByStoreName } from "@vendetta/metro";
import { logger } from "@vendetta";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";
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
    return isFilteredUser(getRefAuthorId(msg));
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

// ---------- One-time refresh after start ----------

const REFRESH_DELAY_MS = 2000;
let refreshTimer = null;

// Re-dispatches MESSAGE_UPDATE for cached messages of the open channel that need
// converting/hiding, so their rows are rendered again through our patches.
// Replies get a real change (type 0, no reference) so Discord must re-render them.
const refreshVisibleMessages = () => {
    let info = "";
    try {
        const MessageStore = findByStoreName("MessageStore");
        const SelectedChannelStore = findByStoreName("SelectedChannelStore");
        const channelId = SelectedChannelStore?.getChannelId?.();

        const collection = channelId ? MessageStore?.getMessages?.(channelId) : null;
        const messages = collection?.toArray?.() ?? collection?._array ?? [];

        let converted = 0;
        let hidden = 0;
        let replies = 0;
        let resolved = 0;
        for (const msg of messages) {
            if (msg.type === MESSAGE_TYPE_REPLY) {
                replies++;
                if (getRefAuthorId(msg)) resolved++;
            }
            let update = null;

            if (shouldConvert(msg)) {
                update = {
                    id: msg.id,
                    channel_id: channelId,
                    type: MESSAGE_TYPE_DEFAULT,
                    message_reference: null,
                    referenced_message: null,
                };
                converted++;
            } else if (shouldHide(msg)) {
                update = { id: msg.id, channel_id: channelId };
                hidden++;
            }

            if (update) {
                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    message: update,
                    __hbiRefresh: true, // our dispatch patch lets this one through untouched
                });
            }
        }

        info = `channel=${!!channelId} store=${!!MessageStore} msgs=${messages.length} replies=${replies} resolved=${resolved} converted=${converted} hidden=${hidden}`;
    } catch (err) {
        info = `ERROR ${err?.message ?? err}`;
        logger.error(`[${pluginName}] Startup refresh failed:`, err);
    }

    console.log(`[${pluginName}] Startup refresh: ${info}`);
    try { showToast(`HideBlocked refresh: ${info}`); } catch (e) {}
};

// ---------- Patches ----------

let patches = [];

const startPlugin = () => {
    try {
        const patch1 = before("dispatch", FluxDispatcher, ([event]) => {
            try {
                if (!event || event.__hbiRefresh) return;

                if (event.type === "LOAD_MESSAGES_SUCCESS") {
                    event.messages = (event.messages ?? []).filter((msg) => !shouldHide(msg));
                    for (const msg of event.messages) {
                        if (shouldConvert(msg)) convertToNormalMessage(msg);
                    }
                }

                if (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") {
                    if (shouldHide(event.message)) {
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
            refreshVisibleMessages();
        }, REFRESH_DELAY_MS);
    },

    onUnload: () => {
        logger.log(`Unloading ${pluginName}...`);
        if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
        for (let unpatch of patches) unpatch();
        patches = [];
        logger.log(`${pluginName} unloaded.`);
    },

    settings: Settings,
};
