import { FluxDispatcher } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { findByProps, findByName } from "@vendetta/metro";
import { logger } from "@vendetta";
import { storage } from "@vendetta/plugin";
import Settings from "./settings";

const RowManager = findByName("RowManager");
const { isBlocked, isIgnored } = findByProps("isBlocked", "isIgnored");

const pluginName = "HideBlockedAndIgnoredMessages";

// Discord message type for replies
const MESSAGE_TYPE_REPLY = 19;
const MESSAGE_TYPE_DEFAULT = 0;

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

// User filter logic
const isFilteredUser = (id) => {
    if (!id) return false;
    if (storage.blocked && isBlocked(id)) return true;
    if (storage.ignored && isIgnored(id)) return true;
    return false;
};

// Is this message a reply to a blocked/ignored user?
const isReplyToFiltered = (msg) => {
    if (!msg) return false;
    const refAuthorId =
        msg.referenced_message?.author?.id ??
        msg.referencedMessage?.message?.author?.id;
    return isFilteredUser(refAuthorId);
};

// Should the message be hidden completely?
const shouldHide = (msg) => {
    if (!msg) return false;
    if (isFilteredUser(msg.author?.id)) return true;

    // "Convert" has priority over "remove"
    if (storage.removeReplies && !storage.convertReplies && isReplyToFiltered(msg)) {
        return true;
    }

    return false;
};

// Should the message be turned into a normal (non-reply) message?
const shouldConvert = (msg) => {
    if (!msg || !storage.convertReplies) return false;
    if (isFilteredUser(msg.author?.id)) return false; // hidden anyway
    return isReplyToFiltered(msg);
};

// Set a property safely (some fields are getter-only or frozen on Message objects)
const safeSet = (obj, key, value) => {
    try {
        obj[key] = value;
        if (obj[key] === value) return;
    } catch (e) {}
    try {
        Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: true });
    } catch (e) {}
};

// Strip all reply info so the message looks like a normal one (mutates in place)
const convertToNormalMessage = (msg) => {
    if (!msg) return;
    safeSet(msg, "referenced_message", null);
    safeSet(msg, "referencedMessage", null);
    safeSet(msg, "message_reference", null);
    safeSet(msg, "messageReference", null);
    if (msg.type === MESSAGE_TYPE_REPLY) safeSet(msg, "type", MESSAGE_TYPE_DEFAULT);
};

// For render: build a copy of the message record so frozen/getter-only fields don't matter
const convertedCopy = (msg) => {
    try {
        let copy;
        if (typeof msg.merge === "function") {
            copy = msg.merge({
                type: MESSAGE_TYPE_DEFAULT,
                messageReference: null,
                referencedMessage: null,
            });
        } else {
            copy = Object.assign(Object.create(Object.getPrototypeOf(msg)), msg);
        }
        convertToNormalMessage(copy);
        return copy;
    } catch (e) {
        logger.error(`[${pluginName}] copy failed:`, e);
        convertToNormalMessage(msg);
        return msg;
    }
};

// TEMP DEBUG: log row info for ignored/blocked rows (remove later)
let rowDebugCount = 0;
const debugRow = (data) => {
    if (rowDebugCount >= 12) return;
    const m = data?.message;
    const authorFiltered = isFilteredUser(m?.author?.id);
    if (!authorFiltered && data?.rowType !== 2) return;
    rowDebugCount++;
    try {
        logger.log(
            `[${pluginName}][DBG] convert=${!!storage.convertReplies} removeReplies=${!!storage.removeReplies}`,
            `rowType=${data.rowType}`,
            `authorFiltered=${authorFiltered}`,
            `msgType=${m?.type}`,
            `hasRef=${!!(m?.referenced_message || m?.referencedMessage || m?.messageReference)}`,
            `dataKeys=${Object.keys(data).join(",")}`
        );
    } catch (e) {}
};

let patches = [];

const startPlugin = () => {
    try {
        // Patch dispatcher
        const patch1 = before("dispatch", FluxDispatcher, ([event]) => {
          try {
            if (!event) return;
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

        // Patch render
        const patch2 = before("generate", RowManager.prototype, ([data]) => {
          try {
            if (!data) return;
            debugRow(data);
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
                // Row data can carry its own reply info too
                safeSet(data, "referencedMessage", null);
                safeSet(data, "referenced_message", null);
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

        // Initialize settings
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
    },

    onUnload: () => {
        logger.log(`Unloading ${pluginName}...`);
        for (let unpatch of patches) unpatch();
        patches = [];
        logger.log(`${pluginName} unloaded.`);
    },

    settings: Settings,
};
