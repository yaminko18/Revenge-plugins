import { findByName } from '@vendetta/metro'
import { after } from '@vendetta/patcher'

// Rovnaký lookup ako v Custom User Tags pluginu (overené funkčné): toto je
// funkcia, ktorú Discord volá pri renderovaní hlavičky správy v chate, aby
// zistila, aký "tag" (napr. BOT, staff badge...) sa má zobraziť vedľa mena.
// Dostáva priamo `message`, takže vieme rozhodovať per-správa (nie per-user).
const getTagProperties = findByName('getTagProperties', false)

export default function patchE2EIndicator() {
    if (!getTagProperties) {
        console.error('[E2E] getTagProperties sa nenašiel - indikátor pri správach nebude fungovať (šifrovanie samotné tým nie je dotknuté).')
        return () => {}
    }

    return after('default', getTagProperties, ([{ message }]: any[], ret: any) => {
        if (!message?.__e2eDecrypted) return ret
        // Ak správa už má iný natívny tag (napr. BOT), nechaj ho tak -
        // neprepisuj existujúce Discord tagy.
        if (ret?.tagType) return ret

        return {
            ...ret,
            tagText: '🟢',
            tagTextColor: undefined,
            tagBackgroundColor: undefined,
            tagVerified: false,
            tagType: undefined,
        }
    })
}
