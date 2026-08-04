export interface E2EKeyPair {
    publicKey: string
    secretKey: string
}

export interface E2EState {
    enabled: boolean
    keyPair: E2EKeyPair
    contacts: Record<string, string> // userId -> base64 verejný kľúč
}
