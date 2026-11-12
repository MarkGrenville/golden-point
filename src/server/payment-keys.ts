import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.GP_KEYS_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret))
    throw new Error("GP_KEYS_SECRET must be a 32-byte hex key");
  return Buffer.from(secret, "hex");
}
export function encryptKeys(value: unknown, workspaceId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(workspaceId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
export function decryptKeys<T>(
  value: ReturnType<typeof encryptKeys>,
  workspaceId: string,
): T {
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(value.iv, "base64"),
  );
  cipher.setAAD(Buffer.from(workspaceId));
  cipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(value.ciphertext, "base64")),
      cipher.final(),
    ]).toString("utf8"),
  );
}
