import { findByProps } from '@vendetta/metro'
import { storage } from '@vendetta/plugin'
import { decryptMessage, encryptMessage, generateKeyPair } from './crypto'

export function initE2E() {
    storage.e2e ??= {}
    storage.e2e.enabled ??= false
    storage.e2e.contacts ??= {} // { [userId]: base64 verejný kľúč }
    storage.e2e.keyPair ??= generateKeyPair()
}

let ChannelStore: any

function loadStores() {
    ChannelStore ??= findByProps('getChannel', 'getDMFromUserId')
}

/**
 * Vráti Discord ID druhej osoby v 1:1 DM kanáli, alebo null ak kanál nie je
 * 1:1 DM (skupinové DM aj servery zámerne vynechané - jeden shared keypair
 * nevie adresovať viacero príjemcov naraz bez ďalšieho dizajnu).
 */
export function getDMRecipientId(channelId: string): string | null {
    loadStores()
    const channel = ChannelStore?.getChannel?.(channelId)
    if (!channel || channel.type !== 1) return null

    const rid = channel.recipients?.[0]
    const id = typeof rid === 'string' ? rid : rid?.id
    return id ?? null
}

/** Je E2E aktívne pre tento konkrétny kanál (zapnuté globálne + je to 1:1 DM)? */
export function isE2EActive(channelId: string): boolean {
    if (!storage.e2e?.enabled) return false
    return getDMRecipientId(channelId) !== null
}

/** Zašifruje text pre daný kanál. Vráti null ak nemáme verejný kľúč príjemcu. */
export function encryptForChannel(channelId: string, plaintext: string): string | null {
    const recipientId = getDMRecipientId(channelId)
    if (!recipientId) return null

    const recipientKey = storage.e2e.contacts?.[recipientId]
    if (!recipientKey) return null

    return encryptMessage(plaintext, recipientKey, storage.e2e.keyPair.secretKey)
}

/**
 * Dešifruje payload pre daný kanál. Vďaka Diffie-Hellman vlastnosti nacl.box
 * (shared secret je rovnaký pre (mojKluc, ichVerejny) aj (ichKluc, mojVerejny))
 * funguje toto rovnako pre správy, čo si poslal TY, aj pre správy od druhej strany -
 * netreba teda vedieť, kto presne je autor danej správy.
 */
export function decryptFromChannel(channelId: string, payload: string): string | null {
    const recipientId = getDMRecipientId(channelId)
    if (!recipientId) return null

    const recipientKey = storage.e2e.contacts?.[recipientId]
    if (!recipientKey) return null

    return decryptMessage(payload, recipientKey, storage.e2e.keyPair.secretKey)
}
