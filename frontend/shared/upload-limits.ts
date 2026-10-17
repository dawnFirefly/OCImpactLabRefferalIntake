/** Attachment/private storage limit. Claude's inline base64 request has a separate ceiling. */
export const maxPacketMegabytes = 50;
export const maxPacketBytes = maxPacketMegabytes * 1024 * 1024;
export const maxInlineAnalysisBytes = 20 * 1024 * 1024;
