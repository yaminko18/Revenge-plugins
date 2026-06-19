import { ReactNative as RN } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";

const { FormInput, FormRow, FormSection } = Forms;

type Mode = "quotes" | "random" | "typed";

const MODES: { value: Mode; label: string; sub: string }[] = [
    { value: "quotes", label: "Movie Quotes",   sub: "České filmové hlášky ako názov súboru" },
    { value: "random", label: "Random String",  sub: "Náhodný alfanumerický reťazec" },
    { value: "typed",  label: "By File Type",   sub: "image0, video0, file0 podľa typu súboru" },
];

export default () => {
    useProxy(storage);

    const mode: Mode = storage.mode ?? "quotes";

    return (
        <RN.ScrollView>
            <FormSection title="NAMING MODE">
                {MODES.map(({ value, label, sub }) => (
                    <FormRow
                        key={value}
                        label={label}
                        subLabel={sub}
                        trailing={
                            <RN.Text style={{ fontSize: 20, color: mode === value ? "#5865F2" : "#72767D" }}>
                                {mode === value ? "●" : "○"}
                            </RN.Text>
                        }
                        onPress={() => (storage.mode = value)}
                    />
                ))}
            </FormSection>
            {mode === "random" && (
                <FormSection title="RANDOM STRING">
                    <FormInput
                        title="FILENAME LENGTH"
                        keyboardType="numeric"
                        placeholder="8"
                        value={(storage.nameLength ?? 8).toString()}
                        onChange={(v: string) => (storage.nameLength = v.replace(/[^0-9]/g, ""))}
                    />
                </FormSection>
            )}
        </RN.ScrollView>
    );
};
