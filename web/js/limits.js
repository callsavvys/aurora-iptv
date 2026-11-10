/* Numbers the app runs by, in one place so a test or a trace can find them. */

// how long boot waits for the television's saved data before starting
// read-only (web/js/boot.js); tests shorten it with ?bootTimeout=<ms>
export const BOOT_TIMEOUT_MS = 5000;
// "Try again" on the read-only banner reloads at most this many times in a row
export const BOOT_RETRIES = 3;
