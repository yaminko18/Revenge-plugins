import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { View, ScrollView } = ReactNative;

export default function Settings() {
    useProxy(storage);

    return (
        <ScrollView>
            <View>
                <Forms.FormSwitchRow
                    label="Remove blocked messages"
                    value={storage.blocked ?? true}
                    onValueChange={(v) => (storage.blocked = v)}
                    note=""
                />
                <Forms.FormSwitchRow
                    label="Remove ignored messages"
                    value={storage.ignored ?? true}
                    onValueChange={(v) => (storage.ignored = v)}
                    note=""
                />
                <Forms.FormSwitchRow
                    label="Remove replies to blocked/ignored users"
                    value={storage.removeReplies ?? true}
                    onValueChange={(v) => {
                        storage.removeReplies = v;
                        // Mutually exclusive with converting
                        if (v) storage.convertReplies = false;
                    }}
                    note="Filters messages replying to blocked or ignored users."
                />
                <Forms.FormSwitchRow
                    label="Convert replies to normal messages"
                    value={storage.convertReplies ?? false}
                    onValueChange={(v) => {
                        storage.convertReplies = v;
                        // Mutually exclusive with removing
                        if (v) storage.removeReplies = false;
                    }}
                    note="Replies to blocked or ignored users are not hidden. They are shown as normal messages without the reply header."
                />
            </View>
        </ScrollView>
    );
}
