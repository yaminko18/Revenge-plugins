import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { ReactNative, React } from "@vendetta/metro/common";

const { FormSwitchRow, FormSection } = Forms;
const { ScrollView } = ReactNative;

export default function Settings() {
    useProxy(storage);

    return (
        <ScrollView style={{ flex: 1 }}>
            <FormSection title="Režimy prekladu" titleStyle={{ marginTop: 20 }}>
                <FormSwitchRow
                    label="Priamo upraviť text správy"
                    subLabel="ZAPNUTÉ: Mení text v bubline. VYPNUTÉ: Červený text pod správou."
                    value={storage.overwriteMode ?? false}
                    onValueChange={(v) => storage.overwriteMode = v}
                />
                <FormSwitchRow
                    label="Ponechať pôvodný text (v zátvorke)"
                    subLabel="Zobrazí české slovo a vedľa neho slovenský preklad tučným písmom. Funguje len pri zapnutej voľbe vyššie."
                    value={storage.showBoth ?? false}
                    onValueChange={(v) => storage.showBoth = v}
                    disabled={!storage.overwriteMode}
                />
            </FormSection>
        </ScrollView>
    );
}
