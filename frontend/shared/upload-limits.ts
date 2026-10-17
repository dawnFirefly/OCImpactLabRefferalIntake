/** One limit for every endpoint: attachments, private storage and Claude analysis (large PDFs use the Files API). */
export const maxPacketMegabytes = 50;
export const maxPacketBytes = maxPacketMegabytes * 1024 * 1024;
