/*
 * WhoReacted — DEBUG verzia (dočasná, na diagnostiku prečo sa nič nezobrazuje)
 * Pôvodne Vencord plugin (Copyright (c) 2022 Vendicated and contributors, GPLv3)
 *
 * Táto verzia pridáva logger.log na každý kritický krok:
 *   1. Spustil sa vôbec onLoad?
 *   2. Našiel sa modul MessageReactionsContent?
 *   3. Zavolal sa vôbec náš instead() patch?
 *   4. Má props.reactions dáta, ako čakáme?
 *
 * Namiesto AvatarPile/Avatar (ktoré môžu zlyhať potichu, keď je čo i len
 * jeden prop v nesprávnom tvare) vraciame najprv čistý viditeľný text —
 * najjednoduchší možný test, či sa vôbec niečo z nášho kódu dostane do
 * vykresleného stromu.
 *
 * Sleduj logy cez Revenge Settings → Developer → Logs (alebo ekvivalent),
 * prípadne cez /bfeval: typeof globalThis.__wr_debug potom
 * JSON.stringify(globalThis.__wr_debug)
 */

import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { instead, before } from "@vendetta/patcher";
import { logger } from "@vendetta";

(globalThis as any).__wr_debug = (globalThis as any).__wr_debug ?? [];
function dbg(msg: string, data?: any) {
    const line = `[WhoReacted DEBUG] ${msg}`;
    logger.log(line, data ?? "");
    (globalThis as any).__wr_debug.push({ msg, data, t: Date.now() });
}

const ChannelStore = findByStoreName("ChannelStore");
const UserStore = findByStoreName("UserStore");
const RestAPI = findByProps("getAPIBaseURL", "get");
const Constants = findByProps("Endpoints");

const { AvatarPile } = findByProps("AvatarPile") ?? {};
const AvatarModule = findByProps("AvatarSizes") ?? {};
const Avatar = AvatarModule.default;
const AvatarSizes = AvatarModule.AvatarSizes ?? { XSMALL: "xsmall" };

function findModuleExportsByFilePathSuffix(suffix: string): any | null {
    const reg = (globalThis as any).modules;
    if (!reg) return null;
    for (const id in reg) {
        const entry = reg[id];
        if (entry?.__filePath?.endsWith(suffix)) {
            return entry.publicModule?.exports ?? null;
        }
    }
    return null;
}

interface ReactionCacheEntry {
    fetched: boolean;
    users: Map<string, any>;
}

let reactions: Record<string, ReactionCacheEntry> = {};
let patches: (() => void)[] = [];
let queue: Promise<any> = Promise.resolve();

function sleep(ms: number) {
    return new Promise(res => setTimeout(res, ms));
}

function enqueue(task: () => Promise<void>) {
    queue = queue.then(task).catch(e => logger.error("[WhoReacted]", e));
}

function fetchReactions(msg: any, emoji: any, type: number) {
    const key = emoji.name + (emoji.id ? `:${emoji.id}` : "");
    dbg("fetchReactions volané", { channel: msg.channel_id, message: msg.id, key });
    return RestAPI.get({
        url: Constants.Endpoints.REACTIONS(msg.channel_id, msg.id, key),
        query: { limit: 100, type },
        oldFormErrors: true
    })
        .then((res: any) => {
            dbg("fetchReactions OK", { count: res?.body?.length });
            for (const user of res.body) {
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
            }
            FluxDispatcher.dispatch({
                type: "MESSAGE_REACTION_ADD_USERS",
                channelId: msg.channel_id,
                messageId: msg.id,
                users: res.body,
                emoji,
                reactionType: type
            });
        })
        .catch((e: any) => dbg("fetchReactions CHYBA", String(e)))
        .finally(() => sleep(250));
}

function getReactionsWithQueue(msg: any, e: any, type: number) {
    const key = `${msg.id}:${e.name}:${e.id ?? ""}:${type}`;
    const cache = reactions[key] ??= { fetched: false, users: new Map() };
    if (!cache.fetched) {
        enqueue(() => fetchReactions(msg, e, type));
        cache.fetched = true;
    }
    return cache.users;
}

function useForceUpdate() {
    const [, setTick] = React.useState(0);
    return React.useCallback(() => setTick((t: number) => t + 1), []);
}

function ReactionUsers({ message, emoji, type }: { message: any; emoji: any; type: number }) {
    dbg("ReactionUsers RENDER", { messageId: message.id, emoji: emoji?.name });
    const forceUpdate = useForceUpdate();

    React.useEffect(() => {
        const cb = (e: any) => {
            if (e?.messageId === message.id) forceUpdate();
        };
        FluxDispatcher.subscribe("MESSAGE_REACTION_ADD_USERS", cb);
        return () => FluxDispatcher.unsubscribe("MESSAGE_REACTION_ADD_USERS", cb);
    }, [message.id]);

    const reactionUsers = getReactionsWithQueue(message, emoji, type);
    const users = Array.from(reactionUsers, ([id]) => UserStore.getUser(id)).filter(Boolean);

    // ─── DEBUG: namiesto AvatarPile/Avatar vraciame čistý text ───
    return (
        <>
            {" 🔥[" + users.length + " users]🔥"}
        </>
    );

    // Pôvodná (finálna) verzia — zapoj späť, keď debug text funguje:
    // if (!AvatarPile || !Avatar) return null;
    // const guildId = ChannelStore.getChannel(message.channel_id)?.guild_id;
    // return (
    //     <AvatarPile size={AvatarSizes.XSMALL} totalCount={users.length} names={users.map((u: any) => u.username)}>
    //         {users.map((u: any) => <Avatar key={u.id} user={u} size={AvatarSizes.XSMALL} guildId={guildId} />)}
    //     </AvatarPile>
    // );
}

export function onLoad() {
    dbg("onLoad spustený");

    const ReactionsModule = findModuleExportsByFilePathSuffix(
        "modules/reactions/native/MessageReactionsContent.tsx"
    );

    dbg("hľadanie modulu dokončené", { found: !!ReactionsModule?.MessageReactionsContent });

    if (ReactionsModule?.MessageReactionsContent) {
        patches.push(
            instead("MessageReactionsContent", ReactionsModule, (args: any[], orig: (...a: any[]) => any) => {
                dbg("instead() patch ZAVOLANÝ", { propsKeys: args[0] ? Object.keys(args[0]) : null });

                const [props] = args;
                const original = orig(...args);

                if (!props?.reactions?.length) {
                    dbg("žiadne props.reactions — vraciam original bez zmeny", { reactions: props?.reactions });
                    return original;
                }

                dbg("props.reactions nájdené", { count: props.reactions.length });

                const message = { id: props.messageId, channel_id: props.channelId };

                return (
                    <>
                        {original}
                        {props.reactions.map((reaction: any) => (
                            <ReactionUsers
                                key={reaction.emoji?.id ?? reaction.emoji?.name}
                                message={message}
                                emoji={reaction.emoji}
                                type={reaction.reactionType ?? 0}
                            />
                        ))}
                    </>
                );
            })
        );
        dbg("instead() patch nastavený");
    } else {
        dbg("CHYBA: modul MessageReactionsContent sa nenašiel");
    }

    const MessageReactionsStore = findByStoreName("MessageReactionsStore");
    if (MessageReactionsStore) {
        patches.push(
            before("initialize", MessageReactionsStore, () => {
                reactions = (MessageReactionsStore as any).reactions ?? reactions;
            })
        );
    }
}

export function onUnload() {
    patches.forEach(unpatch => unpatch());
    patches = [];
    reactions = {};
}
