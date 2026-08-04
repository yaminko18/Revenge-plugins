import { findByProps } from '@vendetta/metro'
import { clipboard, React, ReactNative as RN } from '@vendetta/metro/common'
import { storage } from '@vendetta/plugin'
import { useProxy } from '@vendetta/storage'
import { semanticColors } from '@vendetta/ui'
import { getAssetIDByName } from '@vendetta/ui/assets'
import { showToast } from '@vendetta/ui/toasts'

import type { E2EContact } from './def'

const { View, Text, ScrollView, TouchableOpacity, TextInput, Switch } = RN
const { useMemo, useState } = React

const COLORS = {
    text: semanticColors?.TEXT_NORMAL ?? '#F2F3F5',
    muted: '#949BA4',
    danger: semanticColors?.TEXT_DANGER ?? '#F23F42',
    accent: '#5865F2',
}

function truncateKey(key: string): string {
    if (!key) return 'Key not generated yet...'
    return key.length > 20 ? `${key.slice(0, 10)}...${key.slice(-10)}` : key
}

function setContact(userId: string, patch: Partial<E2EContact>) {
    const current = storage.e2e.contacts?.[userId] ?? { publicKey: '', enabled: true }
    storage.e2e = {
        ...storage.e2e,
        contacts: { ...storage.e2e.contacts, [userId]: { ...current, ...patch } },
    }
}

function removeContact(userId: string) {
    const contacts = { ...storage.e2e.contacts }
    delete contacts[userId]
    storage.e2e = { ...storage.e2e, contacts }
}

interface UserDisplay {
    displayName: string
    username?: string
}

function ContactCard({
    userId,
    contact,
    display,
}: {
    userId: string
    contact: E2EContact
    display: UserDisplay
}) {
    const activeColor = contact.enabled ? COLORS.text : COLORS.muted

    return (
        <View
            style={{
                marginHorizontal: 12,
                marginBottom: 10,
                borderRadius: 12,
                backgroundColor: 'rgba(120,120,128,0.12)',
                paddingHorizontal: 10,
                paddingTop: 8,
                paddingBottom: 10,
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <View style={{ flexShrink: 1 }}>
                    <Text style={{ color: activeColor, fontWeight: '600', fontSize: 15 }} numberOfLines={1}>
                        {display.displayName}
                    </Text>
                    {display.username && (
                        <Text style={{ color: COLORS.muted, fontSize: 12 }} numberOfLines={1}>
                            @{display.username}
                        </Text>
                    )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Switch
                        value={contact.enabled}
                        onValueChange={(v: boolean) => setContact(userId, { enabled: v })}
                        style={{ marginRight: 12 }}
                    />
                    <TouchableOpacity onPress={() => removeContact(userId)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={{ color: COLORS.danger, fontSize: 18, fontWeight: '700' }}>✕</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <Text style={{ color: activeColor, fontSize: 12, marginBottom: 1 }}>This person's public key</Text>
            <TextInput
                placeholder="Enter public key"
                placeholderTextColor={COLORS.muted}
                value={contact.publicKey}
                onChangeText={(v: string) => setContact(userId, { publicKey: v.trim() })}
                style={{
                    color: activeColor,
                    backgroundColor: 'rgba(120,120,128,0.16)',
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    fontSize: 14,
                }}
            />
        </View>
    )
}

export default () => {
    useProxy(storage)

    const [pickerOpen, setPickerOpen] = useState(false)
    const [privateKeyRevealed, setPrivateKeyRevealed] = useState(false)

    const { dmChannels, UserStore } = useMemo(() => {
        let dmChannels: any[] = []
        let UserStore: any = null
        try {
            const sortedStore = findByProps('getSortedPrivateChannels')
            // type 1 = 1:1 DM. Skupinové DM (type 3) zámerne vynechané.
            dmChannels = (sortedStore?.getSortedPrivateChannels?.() ?? []).filter((c: any) => c.type === 1)
            UserStore = findByProps('getUser', 'getCurrentUser')
        } catch {}
        return { dmChannels, UserStore }
    }, [])

    function getRecipientId(channel: any): string | null {
        const rid = channel.recipients?.[0]
        const id = typeof rid === 'string' ? rid : rid?.id
        return id ?? null
    }

    // Rovnaký princíp ako v referenčnom pluginu: zobraz displayName, a pod ním
    // @username len ak sa od displayName reálne líši (inak by to bolo zbytočne
    // duplicitné).
    function getRecipientDisplay(userId: string): UserDisplay {
        const user = UserStore?.getUser?.(userId)
        const displayName = user?.globalName ?? user?.username ?? userId
        const username = user?.username
        const showUsername = !!username && username !== displayName
        return { displayName, username: showUsername ? username : undefined }
    }

    const contacts: Record<string, E2EContact> = storage.e2e?.contacts ?? {}
    const contactIds = Object.keys(contacts)

    // DM kanály, ktoré ešte nie sú pridané ako kontakt - toto je zoznam na
    // výber pri "Pridať používateľa" (namiesto ručného zadávania ID).
    const availableChannels = dmChannels.filter((channel: any) => {
        const userId = getRecipientId(channel)
        return userId && !contacts[userId]
    })

    const copyOwnPublicKey = () => {
        if (!storage.e2e?.keyPair?.publicKey) return
        clipboard.setString(storage.e2e.keyPair.publicKey)
        showToast('Public key copied to clipboard', getAssetIDByName('CopyIcon'))
    }

    // Súkromný kľúč je skrytý, kým naň klikneš - odhalí sa aj rovno skopíruje.
    // Tento kľúč sa nesmie dostať k nikomu inému.
    const revealAndCopyPrivateKey = () => {
        if (!storage.e2e?.keyPair?.secretKey) return
        setPrivateKeyRevealed(true)
        clipboard.setString(storage.e2e.keyPair.secretKey)
        showToast('Private key copied - never send this to anyone!', getAssetIDByName('ic_warning_24px'))
    }

    return (
        <ScrollView>
            <Text style={{ color: COLORS.muted, fontSize: 13, marginHorizontal: 16, marginTop: 10, marginBottom: 6 }}>
                E2E encryption only works for 1:1 DMs. Add a user from the list below, paste their public
                key, and turn on the switch - encryption will be activated only for that specific person.
            </Text>

            <TouchableOpacity
                onPress={copyOwnPublicKey}
                style={{
                    marginHorizontal: 16,
                    marginBottom: 8,
                    padding: 10,
                    borderRadius: 8,
                    backgroundColor: 'rgba(120,120,128,0.12)',
                }}
            >
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>My public key (tap to copy)</Text>
                <Text style={{ color: COLORS.text, fontSize: 13, marginTop: 2 }}>
                    {truncateKey(storage.e2e?.keyPair?.publicKey ?? '')}
                </Text>
            </TouchableOpacity>

            <TouchableOpacity
                onPress={revealAndCopyPrivateKey}
                style={{
                    marginHorizontal: 16,
                    marginBottom: 12,
                    padding: 10,
                    borderRadius: 8,
                    backgroundColor: 'rgba(242,63,66,0.12)',
                }}
            >
                <Text style={{ color: COLORS.danger, fontSize: 12 }}>
                    My private key (tap to reveal and copy - never send this to anyone)
                </Text>
                <Text style={{ color: COLORS.text, fontSize: 13, marginTop: 2 }}>
                    {privateKeyRevealed ? truncateKey(storage.e2e?.keyPair?.secretKey ?? '') : '••••••••••••••••••••'}
                </Text>
            </TouchableOpacity>

            {contactIds.map(userId => (
                <ContactCard key={userId} userId={userId} contact={contacts[userId]} display={getRecipientDisplay(userId)} />
            ))}

            <TouchableOpacity
                onPress={() => setPickerOpen(o => !o)}
                activeOpacity={0.7}
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginHorizontal: 12,
                    marginTop: 2,
                    marginBottom: pickerOpen ? 4 : 16,
                    paddingVertical: 11,
                    borderRadius: 8,
                    backgroundColor: COLORS.accent,
                }}
            >
                <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginRight: 6 }}>+</Text>
                <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 15 }}>Add user</Text>
            </TouchableOpacity>

            {pickerOpen && (
                <View style={{ marginHorizontal: 12, marginBottom: 16 }}>
                    {availableChannels.length === 0 ? (
                        <Text style={{ color: COLORS.muted, fontSize: 13, textAlign: 'center', padding: 12 }}>
                            All your DM conversations have already been added.
                        </Text>
                    ) : (
                        availableChannels.map((channel: any) => {
                            const userId = getRecipientId(channel)!
                            const display = getRecipientDisplay(userId)
                            return (
                                <TouchableOpacity
                                    key={channel.id}
                                    onPress={() => {
                                        setContact(userId, { publicKey: '', enabled: true })
                                        setPickerOpen(false)
                                    }}
                                    style={{
                                        paddingVertical: 10,
                                        paddingHorizontal: 12,
                                        borderRadius: 8,
                                        backgroundColor: 'rgba(120,120,128,0.08)',
                                        marginBottom: 4,
                                    }}
                                >
                                    <Text style={{ color: COLORS.text, fontSize: 14 }}>{display.displayName}</Text>
                                    {display.username && (
                                        <Text style={{ color: COLORS.muted, fontSize: 12 }}>@{display.username}</Text>
                                    )}
                                </TouchableOpacity>
                            )
                        })
                    )}
                </View>
            )}

            <View style={{ height: 24 }} />
        </ScrollView>
    )
}
