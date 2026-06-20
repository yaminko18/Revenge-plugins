import { findByProps } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";

export type FilterMode = "all" | "whitelist";

export function initFilter() {
    storage.filter ??= {
        dmsMode:       "all" as FilterMode,
        guildsMode:    "all" as FilterMode,
        excludedDMs:    [] as string[],
        excludedGuilds: [] as string[],
    };
}

// Lazy-loaded stores – findByProps sa vola len raz
let SelectedChannelStore: any;
let ChannelStore: any;
let SelectedGuildStore: any;

function loadStores() {
    SelectedChannelStore ??= findByProps("getChannelId", "getVoiceChannelId");
    ChannelStore         ??= findByProps("getChannel", "getDMFromUserId");
    SelectedGuildStore   ??= findByProps("getGuildId");
}

export function shouldProcess(): boolean {
    const filter = storage.filter;
    if (!filter) return true;

    const { dmsMode, guildsMode, excludedDMs, excludedGuilds } = filter;

    // Ak su obe "all", ani netreba zistovat aktualny kanal
    if (dmsMode === "all" && guildsMode === "all") return true;

    loadStores();

    const channelId = SelectedChannelStore?.getChannelId?.();
    if (!channelId) return true;

    const channel = ChannelStore?.getChannel?.(channelId);
    if (!channel) return true;

    // type 1 = DM, type 3 = Group DM
    const isDM = channel.type === 1 || channel.type === 3;

    if (isDM) {
        if (dmsMode === "all") return true;
        return !((excludedDMs as string[]) ?? []).includes(channelId);
    } else {
        if (guildsMode === "all") return true;
        const guildId = SelectedGuildStore?.getGuildId?.();
        if (!guildId) return true;
        return !((excludedGuilds as string[]) ?? []).includes(guildId);
    }
}
