import mongoose from "mongoose";
import logger from "@/utils/logger";

interface Migration {
  id: string;
  description: string;
  run: () => Promise<void>;
}

async function dropIndexIfExists(collection: string, indexName: string): Promise<void> {
  try {
    await mongoose.connection.collection(collection).dropIndex(indexName);
    logger.info(`[Migration] Dropped index "${indexName}" on "${collection}"`);
  } catch (err: any) {
    const isNotFound =
      err?.codeName === "IndexNotFound" ||
      err?.code === 27 ||
      String(err?.message ?? "").includes("index not found");
    if (!isNotFound) {
      logger.warn(`[Migration] Could not drop index "${indexName}" on "${collection}": ${err?.message}`);
    }
  }
}

async function ensureIndexExists(
  collection: string,
  spec: Record<string, 1 | -1 | "text">,
  options: Record<string, unknown> = {}
): Promise<void> {
  try {
    await mongoose.connection.collection(collection).createIndex(spec, options);
    logger.info(`[Migration] Ensured index ${JSON.stringify(spec)} on "${collection}"`);
  } catch (err: any) {
    logger.warn(`[Migration] Could not create index on "${collection}": ${err?.message}`);
  }
}

const migrations: Migration[] = [
  {
    id: "001-short-assignments-add-profileId-to-unique-index",
    description:
      "Drop old unique index on short-assignments that lacked profileId, so the new Mongoose index (with profileId) can be created.",
    async run() {
      await dropIndexIfExists(
        "short-assignments",
        "assignedToId_1_shortVideoId_1_assignedByRole_1"
      );
      await ensureIndexExists(
        "short-assignments",
        { assignedToId: 1, shortVideoId: 1, assignedByRole: 1, profileId: 1 },
        { unique: true, background: true }
      );
    },
  },
  {
    id: "002-course-assignments-add-profileId-to-unique-index",
    description:
      "Drop old unique index on course-assignments that lacked profileId, so the new Mongoose index (with profileId) can be created.",
    async run() {
      await dropIndexIfExists(
        "course-assignments",
        "assignedToId_1_courseId_1_assignedByRole_1"
      );
      await ensureIndexExists(
        "course-assignments",
        { assignedToId: 1, courseId: 1, assignedByRole: 1, profileId: 1 },
        { unique: true, background: true }
      );
    },
  },
];

export async function runMigrations(): Promise<void> {
  logger.info(`[Migration] Running ${migrations.length} migration(s)...`);

  for (const migration of migrations) {
    try {
      logger.info(`[Migration] [${migration.id}] ${migration.description}`);
      await migration.run();
      logger.info(`[Migration] [${migration.id}] ✓ Done`);
    } catch (err: any) {
      logger.error(`[Migration] [${migration.id}] ✗ Failed: ${err?.message}`);
    }
  }

  logger.info("[Migration] All migrations complete.");
}
