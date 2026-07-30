import { findByStoreName } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { logger } from "@vendetta";

function HelloWorld() {
    return <>hello</>;
}

let unpatch: (() => void) | undefined;

export function onLoad() {
    logger.log("[TestPlugin] loaded");
}

export function onUnload() {
    logger.log("[TestPlugin] unloaded");
}
