import { db } from "@/lib/auth";

export async function setSessionActiveProfile(token: string, profileId: string): Promise<void> {
  await db.collection("session").updateOne(
    { token },
    { $set: { activeProfileId: profileId, updatedAt: new Date() } }
  );
}

export async function clearSessionActiveProfile(token: string): Promise<void> {
  await db.collection("session").updateOne(
    { token },
    { $set: { activeProfileId: null, updatedAt: new Date() } }
  );
}

// Clears activeProfileId from every session that currently points to a specific profile.
// Used when a single profile is deleted (admin or user).
export async function clearProfileFromAllSessions(userId: string, profileId: string): Promise<void> {
  await db.collection("session").updateMany(
    { userId, activeProfileId: profileId },
    { $set: { activeProfileId: null, updatedAt: new Date() } }
  );
}

// Clears activeProfileId from all sessions for a user.
// Used when the user's role changes away from "user", or the account is deleted.
export async function clearAllActiveProfilesForUser(userId: string): Promise<void> {
  await db.collection("session").updateMany(
    { userId, activeProfileId: { $ne: null } },
    { $set: { activeProfileId: null, updatedAt: new Date() } }
  );
}
