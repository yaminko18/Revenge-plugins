import { findByProps } from '@vendetta/metro'
import { clipboard, ReactNative as RN } from '@vendetta/metro/common'
import { storage } from '@vendetta/plugin'
import { useProxy } from '@vendetta/storage'
import { Forms } from '@vendetta/ui/components'
import { getAssetIDByName } from '@vendetta/ui/assets'
import { showToast } from '@vendetta/ui/toasts'

const { FormRow, FormSection, FormSwitch, FormInput } = Forms

function truncateKey(key: string): string {
    if (!key) return 'Kľúč sa ešte negeneruje...'
    return key.length > 20 ? `${key.slice(0, 10)}...${key.slice(-10)}` : key
}

export default () => {
    useProxy(storage)

    const { dmChannels, UserStore } = (() => {
        let dmChannels: any[] = []
        let UserStore: any = null
        try {
            const sortedStore = findByProps('getSortedPrivateChannels')
            // type 1 = 1:1 DM. Skupinové DM (type 3) zámerne vynechané.
            dmChannels = (sortedStore?.getSortedPrivateChannels?.() ?? []).filter((c: any) => c.type === 1)
            UserStore = findByProps('getUser', 'getCurrentUser')
        } catch {}
        return { dmChannels, UserStore }
    })()

    function getRecipientId(channel: any): string | null {
        const rid = channel.recipients?.[0]
        const id = typeof rid === 'string' ? rid : rid?.id
        return id ?? null
    }

    function getRecipientName(userId: string): string {
        const user = UserStore?.getUser?.(userId)
        return user?.globalName ?? user?.username ?? userId
    }

    const copyOwnKey = () => {
        if (!storage.e2e?.keyPair?.publicKey) return
        clipboard.setString(storage.e2e.keyPair.publicKey)
        showToast('Verejný kľúč skopírovaný do schránky', getAssetIDByName('CopyIcon'))
    }

    return (
        <RN.ScrollView>
            <FormSection title="END-TO-END ŠIFROVANIE (LEN SÚKROMNÉ SPRÁVY)">
                <FormRow
                    label="Zapnúť E2E šifrovanie"
                    subLabel="Šifruje len 1:1 DM správy. Servery a skupinové DM ostávajú nešifrované."
                    trailing={
                        <FormSwitch
                            value={!!storage.e2e?.enabled}
                            onValueChange={(v: boolean) => {
                                storage.e2e = { ...storage.e2e, enabled: v }
                            }}
                        />
                    }
                />

                <FormRow label="Môj verejný kľúč" subLabel={truncateKey(storage.e2e?.keyPair?.publicKey ?? '')} onPress={copyOwnKey} />

                {dmChannels.length === 0 ? (
                    <RN.View style={{ padding: 16, alignItems: 'center' }}>
                        <RN.Text style={{ color: '#949BA4' }}>Žiadne DM konverzácie.</RN.Text>
                    </RN.View>
                ) : (
                    dmChannels.map((channel: any) => {
                        const userId = getRecipientId(channel)
                        if (!userId) return null
                        const value = storage.e2e?.contacts?.[userId] ?? ''

                        return (
                            <RN.View key={channel.id}>
                                <FormRow label={getRecipientName(userId)} />
                                <FormInput
                                    placeholder="Verejný kľúč tejto osoby"
                                    value={value}
                                    onChange={(v: string) => {
                                        storage.e2e = {
                                            ...storage.e2e,
                                            contacts: { ...storage.e2e.contacts, [userId]: v.trim() },
                                        }
                                    }}
                                />
                            </RN.View>
                        )
                    })
                )}
            </FormSection>
        </RN.ScrollView>
    )
}
