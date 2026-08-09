import { FluxDispatcher } from '@vendetta/metro/common'
import { before } from '@vendetta/patcher'
import { decryptFromChannel, isE2EActive, markDecrypted } from './e2e'

// Mutates a message object's content in place, before it reaches the store/UI.
// This only changes what is rendered locally on this device - it does not
// edit the message on Discord's servers and is invisible to anyone else.
function processMessage(msg: any) {
    if (!msg?.content || typeof msg.content !== 'string') return

    const channelId = msg.channel_id ?? msg.channelId
    if (!channelId || !isE2EActive(channelId)) return

    // Skús dešifrovať. Ak zlyhá (napr. správa v skutočnosti nebola
    // zašifrovaná), necháme pôvodný text - nič sa nepokazí.
    const decrypted = decryptFromChannel(channelId, msg.content)
    if (decrypted !== null) {
        msg.content = decrypted
        // Zaznamenaj do oddelenej evidencie (nie priamo na msg objekt - pozri
        // komentár pri markDecrypted v e2e.ts, prečo).
        if (msg.id) markDecrypted(channelId, msg.id)
    }
}

export default function patchMessageDisplay() {
    return before('dispatch', FluxDispatcher, ([event]: any[]) => {
        if (!event) return

        if ((event.type === 'MESSAGE_CREATE' || event.type === 'MESSAGE_UPDATE') && event.message) {
            processMessage(event.message)
        }

        if (event.type === 'LOAD_MESSAGES_SUCCESS' && Array.isArray(event.messages)) {
            event.messages.forEach(processMessage)
        }
    })
}
