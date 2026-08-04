export interface E2EKeyPair {
    publicKey: string
    secretKey: string
}

export interface E2EContact {
    publicKey: string
    enabled: boolean
}

export interface E2EState {
    keyPair: E2EKeyPair
    contacts: Record<string, E2EContact> // userId -> kontakt
}
