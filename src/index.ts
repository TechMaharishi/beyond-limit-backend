import 'dotenv/config'
import app from '@/app'
import { ensureDefaultTicketType } from '@/models/ticket-type'
import { connectDB } from '@/config/database'
import { startCaptionWorker } from '@/workers/captionWorker'


const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await connectDB()
  await ensureDefaultTicketType()

  // Start the caption polling worker (60s interval, MongoDB-based queue)
  startCaptionWorker();
  const { default: cron } = await import("node-cron");
  const { recomputePopularCoursesAllService } = await import("@/services/popular-course");
  recomputePopularCoursesAllService().catch(() => { /* ignore to not block startup */ });
  cron.schedule("0 0 * * *", async () => {  //"Change it to this before deploying 0 0 * * *" Change 
    try {
      await recomputePopularCoursesAllService();
      console.log("Popular courses recompute completed (all-time)");
    } catch (err) {
      console.error("Popular courses recompute failed", err);
    }
  });
});
