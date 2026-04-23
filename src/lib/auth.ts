import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { admin as adminPlugin } from "better-auth/plugins";
import { jwt } from "better-auth/plugins";
import { MongoClient } from "mongodb";
import {
  sendPasswordResetSuccessEmail,
  sendEmailOTPVerification,
} from "@/utils/mailer";
import { ac, admin, trainee, trainer, user } from "@/lib/permission";
import { bearer } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins"
import { expo } from "@better-auth/expo";

const ADMIN_USER_IDS = [
  "6937c1b95bba673ea5f36c10",
  "6969abe3235b3222d9f6ef85",
  "698d0339f9cc18108d4b4f98",
];

const uri = process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI missing");

const client = new MongoClient(uri);
const db = client.db();

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
      beforeDelete: async (user, request) => {
        if (user.email.includes("admin")) {
          throw new APIError("BAD_REQUEST", {
            message: "Admin accounts can't be deleted",
          });
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
