import { createServerFn } from "@tanstack/react-start";

/*
 * Whether a `?key=` passphrase reveals the upload control.
 *
 * The passphrases used to be a list in routes/index.tsx, which put them in
 * the JavaScript every visitor downloads: anyone could read them out of the
 * page source and give themselves the upload button. They now live in the
 * server's `UPLOAD_KEYS` environment variable (comma-separated, see
 * .env.example) and are checked here, so the browser only ever learns yes or
 * no for the one key it was given.
 *
 * Still not a login: a key travels in the address bar, so anyone sent a link
 * with one can use it. It hides a control; it does not protect anything.
 *
 * With `UPLOAD_KEYS` unset, no key works and the upload control stays hidden
 * for everyone.
 */

/** Keys are typed into an address bar by hand, so case and stray spaces do
 *  not count against them. */
function normalise(key: string): string {
  return key.trim().toLowerCase();
}

export function parseUploadKeys(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map(normalise).filter(Boolean);
}

export const checkUploadKey = createServerFn({ method: "GET" })
  .inputValidator((key: unknown) => (typeof key === "string" ? key.slice(0, 40) : ""))
  .handler(({ data: key }) => {
    const keys = parseUploadKeys(process.env.UPLOAD_KEYS);
    return { canUpload: !!key && keys.includes(normalise(key)) };
  });
