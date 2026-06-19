const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif"]);
const VIDEO_EXTS = new Set([".mov", ".mp4", ".avi"]);

export type FilePrefix = "image" | "video" | "file";

export function getTypePrefix(ext: string): FilePrefix {
    const lower = ext.toLowerCase();
    if (IMAGE_EXTS.has(lower)) return "image";
    if (VIDEO_EXTS.has(lower)) return "video";
    return "file";
}
