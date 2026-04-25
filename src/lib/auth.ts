import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { admin as adminPlugin } from "better-auth/plugins/admin";
import { jwt } from "better-auth/plugins/jwt";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import { MongoClient } from "mongodb";
import {
  sendPasswordResetSuccessEmail,
  sendEmailOTPVerification,
  sendWelcomeEmail,
} from "@/utils/mailer";
import { subscribeEmailToMailchimpSafe } from "@/utils/mailchimp";
import { ac, admin, trainee, trainer, user } from "@/lib/permission";
import { APIError } from "better-auth/api";
import { expo } from "@better-auth/expo";

const ADMIN_USER_IDS = [
  "6937c1b95bba673ea5f36c10",
  "6969abe3235b3222d9f6ef85",
  "698d0339f9cc18108d4b4f98",
  "69ea8ad06f8ba4f6a0f6bf28",
  "69eb5c940aa790419e2d490a"
];

const uri = process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI missing");

const client = new MongoClient(uri);
export const db = client.db();

export const auth = betterAuth({
  database: mongodbAdapter(db),
  emailAndPassword: {
    autoSignIn: true,
    enabled: true,
    requireEmailVerification: true,
    resetPassword: true,
    minPasswordLength: 8,
		maxPasswordLength: 128,
    onPasswordReset: async (data) => {
      await sendPasswordResetSuccessEmail({
        email: data.user.email,
      });
    },
  },
  session: {
    additionalFields: {
      activeProfileId: {
        type: "string",
        required: false,
        defaultValue: null,
      },
    },
  },
  user: {
    additionalFields: {
      phone: {
        type: "string",
        required: false,
      },
      newsletter: {
        type: "boolean",
        required: false,
        default: false,
      },
      accountType: {
        type: "string",
        required: true,
        enum: ["free", "develop", "master"],
        default: "free",
      },
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        if (user.email.includes("admin")) {
          throw new APIError("BAD_REQUEST", {
            message: "Admin accounts can't be deleted",
          });
        }
        // Clean up all profiles belonging to this user before the account is removed.
        // Covers both single delete and bulk delete flows since both go through removeUser.
        // We log failures but do not block deletion — an undeleteable account is worse
        // than an orphan profile document that admin can clean up manually.
        try {
          const { Profile } = await import("@/models/profile");
          await Profile.deleteMany({ userId: user.id });
        } catch (err) {
          console.error(`[beforeDelete] Failed to clean up profiles for user ${user.id}:`, err);
        }
      },
    },
  },
  plugins: [
    adminPlugin({
      ac,
      roles: {
        admin,
        trainer,
        trainee,
        user,
      },
      defaultRole: "user",
      adminRoles: ["admin"],
      adminUserIds: ADMIN_USER_IDS,
    }),
    jwt(),
    bearer(),  
    emailOTP({
      overrideDefaultEmailVerification: true,
      async sendVerificationOTP({ email, otp, type, }) {
        let firstName: string | undefined;
        try {
          const normalizedEmail = String(email || "").trim().toLowerCase();
          let userDoc: any = await db.collection("user").findOne({ email: normalizedEmail });
          if (!userDoc) {
            userDoc = await db.collection("user").findOne({ email });
          }
          const candidateName = String((userDoc?.name ?? (userDoc?.data?.name ?? ""))).trim();
          if (candidateName.length > 0) {
            firstName = candidateName;
          }
        } catch {}
        await sendEmailOTPVerification({ email, otp, type, firstName });
      },
      otpLength: 6,
      expiresIn: 900,
      allowedAttempts: 5,
    }),
    expo()  
  ],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const role = (user as any).role ?? "user";
          if (role !== "user") return;
          try {
            const { Profile } = await import("@/models/profile");
            await Profile.findOneAndUpdate(
              { userId: user.id, isDefault: true },
              { $setOnInsert: { userId: user.id, name: "Profile 1", avatar: "", isDefault: true } },
              { upsert: true }
            );
          } catch (err) {
            console.error("[databaseHooks] Failed to auto-create profile:", err);
          }

          // Welcome Email & Mailchimp integration
          try {
            const firstName = user.name ? user.name.trim() : undefined;
            await sendWelcomeEmail({ to: user.email, firstName });
            
            if ((user as any).newsletter) {
              await subscribeEmailToMailchimpSafe({
                email: user.email,
                name: firstName,
                tags: ["mobile-application"],
              });
            }
          } catch (err) {
            console.error("[databaseHooks] Failed to send welcome email/mailchimp:", err);
          }
        },
      },
    },
  },
  trustedOrigins: [process.env.CLIENT_ORIGIN1, process.env.CLIENT_ORIGIN2, "http://localhost:5173", "https://blpt-web.vercel.app"],
  advanced: {
        defaultCookieAttributes: {
            sameSite: "none", 
            secure: true,
            partitioned: true
        }
    }
});

export type Session = typeof auth.$Infer.Session;
