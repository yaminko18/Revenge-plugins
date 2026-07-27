import { findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";

// tag added to all print statements to help with debugging with logcat on adb
const TAG = "[custom-avatars]";

let patches = [];

export { default as settings } from "./settings";

// Moves the old single-user config (targetUserId/imageUrl) into the new
// multi-user "overrides" list, so people upgrading from 1.0.0 don't lose
// their existing setup.
function migrateStorage() {
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
function getOverrideUrl(userId) {
    if (!userId) return undefined;
    const entries = storage.overrides || [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry && entry.enabled === false) continue;
        if (entry && entry.userId === userId && entry.imageUrl) {
            return entry.imageUrl;
        }
    }
    return undefined;
}

export function onLoad() {
    console.log(`${TAG} loaded`);

    migrateStorage();

    const avatarModule = findByProps("getUserAvatarURL");
    if (!avatarModule) {
        console.log(`${TAG} avatar module not found`);
        return;
    }

    // Use Vendetta's official patcher ("after") instead of manually
    // overwriting avatarModule.getUserAvatarSource/getUserAvatarURL.
    // Manually reassigning these functions replaces whatever any other
    // plugin (e.g. one that also touches avatars, like staff-tags) had
    // already patched in, which is what was causing the crash - "after"
    // lets multiple plugins patch the same function without one wiping
    // out another's patch.
    if (avatarModule.getUserAvatarSource) {
        patches.push(after("getUserAvatarSource", avatarModule, (args, res) => {
            const user = args[0];
            const override = getOverrideUrl(user && user.id);
            if (override && res) {
                res.uri = override;
            }
            return res;
        }));
    }

    patches.push(after("getUserAvatarURL", avatarModule, (args, res) => {
        const user = args[0];
        const override = getOverrideUrl(user && user.id);
        if (override) {
            return override;
        }
        return res;
    }));

    const overrideCount = (storage.overrides || []).length;
    console.log(`${TAG} patches applied for ${overrideCount} user(s)`);
}

export function onUnload() {
    console.log(`${TAG} unloading...`);

    // restore patches
    patches.forEach(unpatch => unpatch());
    patches = [];

    console.log(`${TAG} unloaded`);
}
