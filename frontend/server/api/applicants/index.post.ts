/** Creates an applicant from intake details and exactly one combined referral PDF. */
export default defineEventHandler(async (event) => {
  await assertBodySize(event, MAX_PACKET_BYTES + 65536);
  const parts = (await readMultipartFormData(event)) || [];
  const files = parts.filter((p) => p.name === "file" && p.filename);
  const form = Object.fromEntries(
    parts.filter((p) => p.name && !p.filename).map((p) => [p.name!, p.data.toString("utf8")]),
  );
  const intake = parseIntake(form, false);
  if (files.length !== 1) {
    throw createError({ statusCode: 400, statusMessage: "Attach exactly one combined referral PDF." });
  }
  const file = files[0]!;
  const isPdf = file.data.subarray(0, 5).toString("latin1") === "%PDF-";
  if (!file.filename!.toLowerCase().endsWith(".pdf") || !isPdf) {
    throw createError({ statusCode: 400, statusMessage: "The file must be a PDF." });
  }
  if (file.data.length > MAX_PACKET_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "PDF must be 50 MB or smaller." });
  }
  const store = usePacketStore(event);
  const limit = storageLimitBytes(event);
  const driveConfig = useRuntimeConfig(event).googleDrive;
  if ([driveConfig.clientId, driveConfig.clientSecret, driveConfig.refreshToken, driveConfig.folderId].every(Boolean) && !event.context.cloudflare) throw createError({ statusCode: 503, statusMessage: "New persistent reviews require local disk or R2. Disable Google Drive storage to continue." });
  const used = (await store.list()).reduce((sum, p) => sum + (p.size || 0), 0);
  if (used + file.data.length > limit) {
    const size = (bytes: number) =>
      limit >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
    throw createError({
      statusCode: 507,
      statusMessage: `Storage is full (${size(used)} of ${size(limit)} used). Delete old referrals to upload more.`,
    });
  }
  const uploadedAt = new Date().toISOString();
  try {
    return await store.save(
      {
        source: "", contact: "", reviewer: "", notes: "", priority: "routine", reviewStatus: "new",
        ...intake,
        name: intake.name!,
        receivedAt: intake.receivedAt || uploadedAt,
        fileName: file.filename!,
        size: file.data.length,
        uploadedAt,
      },
      file.data,
    );
  } catch (cause) {
    console.error(cause);
    throw createError({ statusCode: 502, statusMessage: "The PDF could not be stored. Check the storage configuration." });
  }
});
