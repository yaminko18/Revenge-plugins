import { React, ReactNative } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

const { View, ScrollView } = ReactNative;

export default function Settings() {
    useProxy(storage);

    // Local state mirrors storage, so the switches update visually right away
    const [state, setState] = React.useState({
        blocked: storage.blocked ?? true,
        ignored: storage.ignored ?? true,
        removeReplies: storage.removeReplies ?? true,
        convertReplies: storage.convertReplies ?? false,
    });

    const update = (changes: Partial<typeof state>) => {
        for (const key of Object.keys(changes)) storage[key] = changes[key];
        setState((prev) => ({ ...prev, ...changes }));
    };

    return (
        <ScrollView>
            <View>
                <Forms.FormSwitchRow
                    label="Remove blocked messages"
                    value={state.blocked}
                    onValueChange={(v) => update({ blocked: v })}
                    note=""
                />
                <Forms.FormSwitchRow
                    label="Remove ignored messages"
                    value={state.ignored}
                    onValueChange={(v) => update({ ignored: v })}
                    note=""
                />
                <Forms.FormSwitchRow
                    label="Remove replies to blocked/ignored users"
                    value={state.removeReplies}
                    onValueChange={(v) =>
                        // Mutually exclusive with converting
                        update(v ? { removeReplies: true, convertReplies: false } : { removeReplies: false })
                    }
                    note="Filters messages replying to blocked or ignored users."
                />
                <Forms.FormSwitchRow
                    label="Convert replies to normal messages"
                    value={state.convertReplies}
                    onValueChange={(v) =>
                        // Mutually exclusive with removing
                        update(v ? { convertReplies: true, removeReplies: false } : { convertReplies: false })
                    }
                    note="Replies to blocked or ignored users are not hidden. They are shown as normal messages without the reply header."
                />
            </View>
        </ScrollView>
    );
}
