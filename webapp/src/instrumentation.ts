// Next.js instrumentation — dijalankan sekali saat server start.
// Menyalakan background jobs live (refresh token, metrik item, auto-pin, prune).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startLiveJobs } = await import("./lib/live-jobs");
    startLiveJobs();
  }
}
