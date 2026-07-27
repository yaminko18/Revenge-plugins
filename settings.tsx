import { findByStoreName } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";

const { View, Text, ScrollView, TouchableOpacity, Image, TextInput, Switch } = ReactNative;

// Fallback colors in case a semanticColors token is missing on some client
// versions - keeps the UI readable either way.
const COLORS = {
    text: semanticColors?.TEXT_NORMAL ?? "#F2F3F5",
    muted: "#949BA4",
    danger: semanticColors?.TEXT_DANGER ?? "#F23F42",
};

interface OverrideEntry {
    id: string;
    userId: string;
    imageUrl: string;
    enabled?: boolean;
}

// Default avatar presets, shown as color swatches so a user can be given a
// look without hunting for an image URL. Point these at your own hosted
// files (bundled in the plugin repo and served via raw.githubusercontent.com,
// or any other static host) - swap the "url" values below for the real ones.
// Single place to change if you move the hosted avatars elsewhere -
// every color's URL is built from this plus "<name>.png".
const AVATAR_BASE_URL = "https://raw.githubusercontent.com/USERNAME/REPO/main/avatars";

const DEFAULT_AVATAR_COLORS: { name: string; color: string }[] = [
    { name: "Red", color: "#FF1F1F" },
    { name: "Orange", color: "#FF7A00" },
    { name: "Amber", color: "#FFB800" },
    { name: "Yellow", color: "#FFE600" },
    { name: "Lime", color: "#B0FF00" },
    { name: "Green", color: "#00E676" },
    { name: "Teal", color: "#00C2D1" },
    { name: "Cyan", color: "#00E5FF" },
    { name: "Sky", color: "#0091FF" },
    { name: "Blue", color: "#2F54EB" },
    { name: "Indigo", color: "#4338CA" },
    { name: "Purple", color: "#B620E0" },
    { name: "Violet", color: "#7C3AED" },
    { name: "Pink", color: "#FF2D95" },
    { name: "Rose", color: "#FF3D68" },
    { name: "Brown", color: "#A15C2E" },
    { name: "Gray", color: "#8E9297" },
    { name: "Black", color: "#101214" },
    { name: "White", color: "#FFFFFF" },
];

const DEFAULT_AVATARS: { name: string; color: string; url: string }[] = DEFAULT_AVATAR_COLORS.map((preset) => ({
    ...preset,
    url: `${AVATAR_BASE_URL}/${preset.name.toLowerCase()}.png`,
}));

const UserStore = findByStoreName("UserStore");

// Builds the user's *real* Discord avatar URL directly from the cached user
// object, bypassing our own patch in index.ts (which would otherwise just
// hand back the override we're trying to compare against).
function getDefaultAvatarUrl(userId?: string): string | undefined {
    if (!userId || !UserStore) return undefined;
    try {
        const user = UserStore.getUser(userId);
        if (!user) return undefined;
        if (user.avatar) {
            const ext = user.avatar.startsWith("a_") ? "gif" : "png";
            return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
        }
        const index = user.discriminator && user.discriminator !== "0"
            ? Number(user.discriminator) % 5
            : Number(BigInt(user.id) >> 22n) % 6;
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch {
        return undefined;
    }
}

function migrateStorage(): void {
    if (!Array.isArray(storage.overrides)) {
        storage.overrides = [];
    }
    if (storage.targetUserId && storage.imageUrl) {
        storage.overrides = [
            ...storage.overrides,
            { id: `${Date.now()}`, userId: storage.targetUserId, imageUrl: storage.imageUrl, enabled: true },
        ];
        delete storage.targetUserId;
        delete storage.imageUrl;
    }

    // Always show at least one entry by default - "add" is for extra users
    // beyond this first one, not for creating the very first slot.
    if (storage.overrides.length === 0) {
        storage.overrides = [{ id: `${Date.now()}`, userId: "", imageUrl: "", enabled: true }];
    }
}

// All three helpers below always assign a brand-new array to
// storage.overrides (never .push()/mutate in place) - the settings screen
// only re-renders when it sees the "overrides" reference itself change, so
// in-place mutation was the reason "add" only showed up after reopening.
function addEntry(): void {
    storage.overrides = [
        ...(storage.overrides ?? []),
        { id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`, userId: "", imageUrl: "", enabled: true },
    ];
}

function removeEntry(id: string): void {
    storage.overrides = (storage.overrides as OverrideEntry[]).filter((entry) => entry.id !== id);
}

function updateEntry(id: string, patch: Partial<OverrideEntry>): void {
    storage.overrides = (storage.overrides as OverrideEntry[]).map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
    );
}

function AvatarPreview({ label, uri, userId, color, showName }: { label: string; uri?: string; userId?: string; color: string; showName?: boolean }) {
    const user = userId && UserStore ? UserStore.getUser(userId) : null;
    const displayName = user?.globalName || user?.username;
    const username = user?.username;
    const showUsername = !!username && !!displayName && username !== displayName;

    return (
        <View>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
                {uri ? (
                    <Image source={{ uri }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                ) : (
                    <View
                        style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: "rgba(120,120,128,0.24)",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Text style={{ color, fontSize: 14 }}>?</Text>
                    </View>
                )}
                {showName && (
                    <View style={{ marginLeft: 8, flexShrink: 1 }}>
                        <Text style={{ color, fontWeight: "600", fontSize: 13 }} numberOfLines={1}>
                            {displayName ?? "Unknown user"}
                        </Text>
                        {showUsername && (
                            <Text style={{ color: "#949BA4", fontSize: 11 }} numberOfLines={1}>
                                @{username}
                            </Text>
                        )}
                    </View>
                )}
            </View>
            <View style={{ width: 36, alignItems: "center" }}>
                <Text style={{ color, fontSize: 11, marginTop: 3, textAlign: "center" }}>{label}</Text>
            </View>
        </View>
    );
}

function OverrideCard({ entry }: { entry: OverrideEntry }) {
    // Anything not explicitly set to false counts as enabled (keeps
    // pre-existing entries working the same as before this field existed).
    const isEnabled = entry.enabled !== false;
    const activeColor = isEnabled ? COLORS.text : COLORS.muted;

    return (
        <View
            style={{
                marginHorizontal: 12,
                marginBottom: 10,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: "rgba(120,120,128,0.12)",
                paddingHorizontal: 10,
                paddingTop: 6,
                paddingBottom: 10,
            }}
        >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <View style={{ flexDirection: "row" }}>
                    <View style={{ marginRight: 16 }}>
                        <AvatarPreview label="Original" uri={getDefaultAvatarUrl(entry.userId)} userId={entry.userId} color={activeColor} />
                    </View>
                    <AvatarPreview label="New" uri={entry.imageUrl || undefined} userId={entry.userId} color={activeColor} showName />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Switch
                        value={isEnabled}
                        onValueChange={(v: boolean) => updateEntry(entry.id, { enabled: v })}
                        style={{ marginRight: 12 }}
                    />
                    <TouchableOpacity onPress={() => removeEntry(entry.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ color: COLORS.danger, fontSize: 18, fontWeight: "700" }}>✕</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <Text style={{ color: activeColor, fontSize: 12, marginBottom: 1 }}>User ID</Text>
            <TextInput
                placeholder="123456789012345678"
                placeholderTextColor={COLORS.muted}
                value={entry.userId}
                onChangeText={(v: string) => updateEntry(entry.id, { userId: v })}
                style={{
                    color: activeColor,
                    backgroundColor: "rgba(120,120,128,0.16)",
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    marginBottom: 6,
                    fontSize: 14,
                }}
            />

            <Text style={{ color: activeColor, fontSize: 12, marginBottom: 1 }}>Image URL</Text>
            <TextInput
                placeholder="https://example.com/avatar.png"
                placeholderTextColor={COLORS.muted}
                value={entry.imageUrl}
                onChangeText={(v: string) => updateEntry(entry.id, { imageUrl: v })}
                style={{
                    color: activeColor,
                    backgroundColor: "rgba(120,120,128,0.16)",
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    marginBottom: 8,
                    fontSize: 14,
                }}
            />

            <Text style={{ color: activeColor, fontSize: 12, marginBottom: 4 }}>
                Or pick a default avatar:
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {DEFAULT_AVATARS.map((preset) => {
                    const selected = entry.imageUrl === preset.url;
                    return (
                        <TouchableOpacity
                            key={preset.name}
                            onPress={() => updateEntry(entry.id, { imageUrl: preset.url })}
                            style={{
                                width: 34,
                                height: 34,
                                borderRadius: 17,
                                marginRight: 8,
                                backgroundColor: preset.color,
                                borderWidth: selected ? 3 : 1,
                                borderColor: selected ? activeColor : COLORS.muted,
                            }}
                        />
                    );
                })}
            </ScrollView>
        </View>
    );
}

export default () => {
    useProxy(storage);
    migrateStorage();

    const overrides: OverrideEntry[] = storage.overrides ?? [];

    return (
        <ScrollView>
            <Text style={{ color: COLORS.muted, fontSize: 13, marginHorizontal: 16, marginTop: 10, marginBottom: 6 }}>
                Add as many users as you like below. For each one, enter their
                Discord User ID and an image URL, or pick one of the default
                presets. Use the switch to enable or disable an override
                without deleting it.
            </Text>

            {overrides.map((entry) => (
                <OverrideCard key={entry.id} entry={entry} />
            ))}

            <TouchableOpacity
                onPress={addEntry}
                activeOpacity={0.7}
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    marginHorizontal: 12,
                    marginTop: 2,
                    marginBottom: 16,
                    paddingVertical: 11,
                    borderRadius: 8,
                    backgroundColor: "#5865F2",
                }}
            >
                <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "700", marginRight: 6 }}>+</Text>
                <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 15 }}>Add user</Text>
            </TouchableOpacity>

            <View style={{ height: 24 }} />
        </ScrollView>
    );
};
