import express, { Application, Request, Response, NextFunction } from 'express';
import { getHealth } from '@/controllers/health/health';
import cors from 'cors';
import helmet from 'helmet';
// import rateLimit from 'express-rate-limit';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '@/lib/auth';
import logger from "@/utils/logger";
import { APIError } from 'better-auth/api';
import superAdminRouter from "@/routes/user/admin";
import accountManagementRouter from "@/routes/user/account";
import shortVideosRouter from "@/routes/content-management/short-videos";
import courseVideosRouter from "@/routes/content-management/course-videos";
import supportRouter from "@/routes/support/support";
import assignClinicalRouter from "@/routes/assign-clinical/assign-clinical";
import popularCourseRouter from "@/routes/popular-course/popular-course";
import assignCourseRouter from "@/routes/assign-course/assign-course";
import deviceTokenRouter from "@/routes/notifications/device-tokens";
import notificationsRouter from "@/routes/notifications/notifications";
import assignShortsRouter from "@/routes/assign-shorts/assign-shorts";
import cloudinaryWebhookRouter from "@/routes/webhooks/cloudinary";
import cloudinaryUploadV1Router from "@/routes/webhooks/cloudinary-upload-v1";
import profilesRouter from "@/routes/user/profiles";
import shortVideosV1Router from "@/routes/content-management/short-videos-v1";
import tagsRouter from "@/routes/tags/tags";



const app: Application = express();
// Health metrics are computed in the controller

// Trust proxy so Express honors X-Forwarded-For from the hosting proxy
// app.set('trust proxy', 1);

app.use(express.json());
// app.use(helmet());

const clientOrigin1 = process.env.CLIENT_ORIGIN1;
const clientOrigin2 = process.env.CLIENT_ORIGIN2;
if (!clientOrigin1 || !clientOrigin2) throw new Error("CLIENT_ORIGIN missing");
const allowedOrigins = [clientOrigin1, clientOrigin2, "http://localhost:5173", "http://127.0.0.1:5173", "https://blpt-web.vercel.app"];
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);
app.options('*splat', cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));



app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.urlencoded({ extended: true }));


app.get('/api/health', getHealth);


function registerRouters(app: Application) {
  app.use("/api", superAdminRouter);
  app.use("/api", accountManagementRouter);
  app.use("/api", profilesRouter);
  app.use("/api", shortVideosRouter);
  app.use("/api", popularCourseRouter);
  app.use("/api", courseVideosRouter);
  app.use("/api", supportRouter);
  app.use("/api", assignClinicalRouter);  
  app.use("/api", assignCourseRouter);
  app.use("/api", assignShortsRouter);
  app.use("/api", deviceTokenRouter);
  app.use("/api", notificationsRouter);
  // Cloudinary webhook for caption transcription notifications
  app.use("/api", cloudinaryWebhookRouter);
  // V1 — two-phase upload flow (signed URL + upload webhook + publish)
  app.use("/api", shortVideosV1Router);
  app.use("/api", cloudinaryUploadV1Router);
  app.use("/api", tagsRouter);
}

registerRouters(app);



app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error("Unhandled error:", err);
  if (err instanceof APIError) {
    return res.status(Number(err.status) || 500).json({ error: err.message });
  }
  res.status(500).send('Something broke!');
});

export default app;


