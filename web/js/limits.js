/* Numbers the app runs by, in one place so a test or a trace can find them. */

// how long boot waits for the television's saved data before starting
// read-only (web/js/boot.js); tests shorten it with ?bootTimeout=<ms>
export const BOOT_TIMEOUT_MS = 5000;
// "Try again" on the read-only banner reloads at most this many times in a row
export const BOOT_RETRIES = 3;
// watch progress is saved at most this often while playing, plus on pause, stop and exit
// (the old app's rule, app/renderer.js; prefs with 3,000 records is about 1 MB)
export const PROGRESS_THROTTLE_MS = 5000;
