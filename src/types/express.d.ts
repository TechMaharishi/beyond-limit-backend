import type { Session as BetterAuthSession } from "@/lib/auth";

declare global {
  namespace Express {
    interface Request {
      session?: BetterAuthSession;
      file?: Express.Multer.File;
    }
  }
}
