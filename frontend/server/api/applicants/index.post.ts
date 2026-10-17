/** Creates an applicant from intake details and exactly one combined referral PDF. */
export default defineEventHandler(async (event) => {
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
  const uploadedAt = new Date().toISOString();
  try {
    return await usePacketStore().save(
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
