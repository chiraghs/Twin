/** Runs once when a server instance starts: load the integration settings saved from the UI. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadSettings } = await import("./server/settings");
    await loadSettings();
  }
}
