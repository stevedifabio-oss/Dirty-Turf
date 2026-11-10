import { createAppleSignatureHandler } from "./_shared/apple-signed-verifier-handler.ts";
import { verifyAppleSignedData } from "./_shared/apple-signed-verifier-sdk.ts";

// No purchase credentials, database clients, or entitlement writes in this service.
declare const Netlify: { env: { get(name: string): string | undefined } };
export default createAppleSignatureHandler(() => Netlify.env.get("APPLE_SIGNATURE_VERIFIER_SECRET"), verifyAppleSignedData);
