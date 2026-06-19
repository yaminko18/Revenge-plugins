import { ReactNative as RN } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";

const { FormInput, FormRow, FormSwitch, FormSection } = Forms;

export default () => {
    useProxy(storage);

    const useQuotes = storage.useQuotes ?? true;

    return (
        <RN.ScrollView>
            <FormSection title="MODE">
                <FormRow
                    label="Movie Quotes"
                    subLabel="Rename files to Czech movie quotes"
                    trailing={
                        <FormSwitch
                            value={useQuotes}
                            onValueChange={(v: boolean) => storage.useQuotes = v}
                        />
                    }
                />
            </FormSection>
            {!useQuotes && (
                <FormSection title="RANDOM STRING">
                    <FormInput
                        title="FILENAME LENGTH"
                        keyboardType="numeric"
                        placeholder="8"
                        value={(storage.nameLength ?? 8).toString()}
                        onChange={(v: string) => storage.nameLength = v.replace(/[^0-9]/g, "")}
                    />
                </FormSection>
            )}
        </RN.ScrollView>
    );
};
