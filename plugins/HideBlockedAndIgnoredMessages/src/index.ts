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

// Strip all reply info so the message looks like a normal one
const convertToNormalMessage = (msg) => {
    if (!msg) return;
    try {
        msg.referenced_message = null;
        msg.referencedMessage = null;
        msg.message_reference = null;
        msg.messageReference = null;
        if (msg.type === MESSAGE_TYPE_REPLY) msg.type = MESSAGE_TYPE_DEFAULT;
    } catch (err) {
        logger.error(`[${pluginName}] Failed to convert reply:`, err);
    }
};

let patches = [];

const startPlugin = () => {
    try {
        // Patch dispatcher
        const patch1 = before("dispatch", FluxDispatcher, ([event]) => {
            if (event.type === "LOAD_MESSAGES_SUCCESS") {
                event.messages = event.messages.filter((msg) => !shouldHide(msg));
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
        });
        patches.push(patch1);

        // Patch render
        const patch2 = before("generate", RowManager.prototype, ([data]) => {
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
                convertToNormalMessage(data.message);
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
