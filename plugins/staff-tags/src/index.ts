import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";

// tag added to all print statements to help with debugging with logcat on adb
const TAG = "[custom-avatars]";

let patches: (() => void)[] = [];

export { default as settings } from "./settings";

interface OverrideEntry {
    id: string;
    userId: string;
    imageUrl: string;
}

// Moves the old single-user config (targetUserId/imageUrl) into the new
// multi-user "overrides" list, so people upgrading from 1.0.0 don't lose
// their existing setup.
function migrateStorage(): void {
    if (!Array.isArray(storage.overrides)) {
        storage.overrides = [];
    }

    if (storage.targetUserId && storage.imageUrl) {
        storage.overrides.push({
            id: `${Date.now()}`,
            userId: storage.targetUserId,
            imageUrl: storage.imageUrl,
        });
        delete storage.targetUserId;
        delete storage.imageUrl;
    }
}

// Reads the current override list live from storage, so entries added or
// edited in settings while the plugin is already loaded take effect
// immediately, without needing a reload.
function getOverrideUrl(userId: string | undefined | null): string | undefined {
    if (!userId) return undefined;
    const entries: OverrideEntry[] = storage.overrides ?? [];
    const match = entries.find((entry) => entry?.userId === userId && entry?.imageUrl);
    return match?.imageUrl;
}

export function onLoad(): void {
    console.log(`${TAG} loaded`);

    migrateStorage();

    const UserStore = findByStoreName("UserStore");
    if (!UserStore) {
        console.log(`${TAG} userStore not found`);
        return;
    }

    const avatarModule = findByProps("getUserAvatarURL");
    if (!avatarModule) {
        console.log(`${TAG} avatar module not found`);
        return;
    }

    // patch getUserAvatarSource, overrides avatar in DMs and group chats
    if (avatarModule.getUserAvatarSource) {
        const originalGetUserAvatarSource = avatarModule.getUserAvatarSource;
        avatarModule.getUserAvatarSource = function (...args: any[]) {
            const user = args[0];
            const override = getOverrideUrl(user?.id);

            if (override) {
                const original = originalGetUserAvatarSource.apply(this, args);
                if (original) {
                    return {
                        ...original,
                        uri: override
                    };
                }
            }
            // no override for this user, fall through
            return originalGetUserAvatarSource.apply(this, args);
        };
        patches.push(() => { avatarModule.getUserAvatarSource = originalGetUserAvatarSource; });
    }

    // patch getUserAvatarURL, overrides avatar in voice calls
    const originalGetUserAvatarURL = avatarModule.getUserAvatarURL;
    avatarModule.getUserAvatarURL = function (...args: any[]) {
        const user = args[0];
        const override = getOverrideUrl(user?.id);

        if (override) {
            return override;
        }
        return originalGetUserAvatarURL.apply(this, args);
    };
    patches.push(() => { avatarModule.getUserAvatarURL = originalGetUserAvatarURL; });

    const overrideCount = (storage.overrides ?? []).length;
    console.log(`${TAG} patches applied for ${overrideCount} user(s)`);

    // refresh ui for every overridden user
    try {
        for (const entry of (storage.overrides ?? []) as OverrideEntry[]) {
            if (!entry?.userId) continue;
            FluxDispatcher.dispatch({
                type: "USER_UPDATE",
                user: UserStore.getUser(entry.userId)
            });
        }
        console.log(`${TAG} ui refreshed`);
    } catch (e) {
        console.log(`${TAG} could not trigger refresh:`, e.message);
    }
}

export function onUnload(): void {
    console.log(`${TAG} unloading...`);

    // restore patches
    patches.forEach(unpatch => unpatch());
    patches = [];

    console.log(`${TAG} unloaded`);
}
