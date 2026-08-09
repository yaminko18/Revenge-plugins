import { findByProps } from '@vendetta/metro'
import { storage } from '@vendetta/plugin'
import { decryptMessage, encryptMessage, generateKeyPair } from './crypto'

export function initE2E() {
    storage.e2e ??= {}
    storage.e2e.contacts ??= {} // { [userId]: { publicKey, enabled } }
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

/**
 * Je E2E aktívne pre tento konkrétny kanál? Teraz sa to riadi len tým, či je
 * daný kontakt (druhá osoba v DM) pridaný do zoznamu a má svoj vlastný
 * prepínač zapnutý - žiadny globálny prepínač už neexistuje.
 */
export function isE2EActive(channelId: string): boolean {
    const recipientId = getDMRecipientId(channelId)
    if (!recipientId) return false
    return storage.e2e?.contacts?.[recipientId]?.enabled === true
}

/** Zašifruje text pre daný kanál. Vráti null ak nemáme verejný kľúč príjemcu. */
export function encryptForChannel(channelId: string, plaintext: string): string | null {
    const recipientId = getDMRecipientId(channelId)
    if (!recipientId) return null

    const recipientKey = storage.e2e.contacts?.[recipientId]?.publicKey
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

    const recipientKey = storage.e2e.contacts?.[recipientId]?.publicKey
    if (!recipientKey) return null

    return decryptMessage(payload, recipientKey, storage.e2e.keyPair.secretKey)
}

/**
 * Evidencia dešifrovaných správ, držaná MIMO samotného message objektu.
 *
 * Prečo: Discordov MessageStore si z prijatých event dát (`event.message`)
 * vytvára vlastný interný MessageRecord objekt a pri tomto kopírovaní zoberie
 * len polia, ktoré pozná (content, author, timestamp...) - akékoľvek vlastné
 * pole, čo by sme pridali priamo na `msg` (napr. msg.__e2eDecrypted), sa touto
 * transformáciou zahodí. Preto namiesto značenia priamo na správe vedieme
 * vlastný, oddelený zoznam kľúčovaný `channelId:messageId` - ten prežije
 * akékoľvek prekopírovanie správy, lebo naň vôbec nezávisí.
 *
 * Ukladá sa len ID (channelId:messageId), nikdy obsah správy. Žije len počas
 * behu appky (nie je to perzistentné naprieč reštartom, na rozdiel od
 * storage.e2e), a nikdy sa nečistí - pri bežnom používaní je to zanedbateľné
 * množstvo pamäte (krátke stringy).
 */
const decryptedMessageIds = new Set<string>()

function decryptedKey(channelId: string, messageId: string): string {
    return `${channelId}:${messageId}`
}

export function markDecrypted(channelId: string, messageId: string) {
    decryptedMessageIds.add(decryptedKey(channelId, messageId))
}

export function isMarkedDecrypted(channelId: string, messageId: string): boolean {
    return decryptedMessageIds.has(decryptedKey(channelId, messageId))
}
