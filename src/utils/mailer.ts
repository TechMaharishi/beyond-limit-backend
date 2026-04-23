import logger from "@/utils/logger";
import { sgMail } from "@/config/email-service";
import fs from "fs";
import path from "path";

const FROM_EMAIL = process.env.EMAIL!;

const LOGO_CID = "app-logo";
let logoAttachmentCache: any | null = null;

function getLogoAttachment() {
  if (logoAttachmentCache) return logoAttachmentCache;
  try {
    const filePath = path.resolve("public", "logo.png");
    const file = fs.readFileSync(filePath);
    logoAttachmentCache = {
      content: file.toString("base64"),
      filename: "logo.png",
      type: "image/png",
      disposition: "inline",
      content_id: LOGO_CID,
    };
  } catch (err) {
    logger.warn("Email logo not found at public/logo.png; sending without logo.");
    logoAttachmentCache = null;
  }
  return logoAttachmentCache || undefined;
}


function otpBlock(otp: string) {
  return `<div style="margin:16px 0; text-align:center;">
    <div style="display:inline-block; font-family:monospace; letter-spacing:3px; font-size:24px; padding:12px 16px; border:1px dashed #d1d5db; border-radius:8px; background:#f9fafb; color:#111;">${otp}</div>
  </div>`;
}

function renderEmailTemplate(opts: { title: string; body: string }) {
  const { title, body } = opts;
  const logo = `<img src="cid:${LOGO_CID}" alt="Beyond Limits Learning Hub" style="height:120px; width:120px; display:inline-block;" />`;
  return `
  <div style="background-color:#f6f9fc; padding:24px; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:#111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e5e7eb;">
      <tr>
        <td style="padding:10px; text-align:center; background:#ffffff; border-bottom:1px solid #eef2f7;">
          ${logo}
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <h2 style="margin:0 0 12px; font-size:20px;">${title}</h2>
          <div style="font-size:15px; line-height:1.6;">
            ${body}
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px; background:#f9fbfd; border-top:1px solid #eef2f7; text-align:center; font-size:12px; color:#6b7280;">
          <p style="margin:0;">This is an automated message. Please do not reply.</p>
          <p style="margin:4px 0 0;">© ${new Date().getFullYear()} Beyond Limits Learning Hub</p>
        </td>
      </tr>
    </table>
  </div>
  `;
}

function toTitleCase(s: string) {
  const lower = s.trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function extractFirstName(name?: string, email?: string) {
  const n = (name || "").trim();
  if (n) {
    const first = n.split(/\s+/)[0];
    return toTitleCase(first);
  }
  const e = (email || "").trim();
  if (e && e.includes("@")) {
    const local = e.split("@")[0];
    const part = local.split(/[._-]+/)[0];
    return toTitleCase(part);
  }
  return "";
}

async function sendMailSafe(msg: any) {
  try {
    const [response] = await sgMail.send(msg);
    return response;
  } catch (err: any) {
    logger.error("SendGrid email error", { error: err?.response?.body || err });
    throw new Error("Failed to send email");
  }
}

export interface SendEmailOTPVerificationArgs {
  email: string;
  otp: string;
  type?: "sign-in" | "email-verification" | "forget-password";
  firstName?: string;
}

export async function sendEmailOTPVerification(
  args: SendEmailOTPVerificationArgs
): Promise<any> {
  const { email, otp, type, firstName } = args;
  const subject = type === "sign-in"
    ? "Your Verification Code"
    : type === "forget-password"
    ? "Your Verification Code"
    : "Your Verification Code";
  const greetName = extractFirstName(firstName, email);
  const logo = getLogoAttachment();
  const response = await sendMailSafe({
    to: email,
    from: FROM_EMAIL,
    subject,
    html: renderEmailTemplate({
      title: "Verification Code",
      body: `
        <p>Hi ${greetName},</p>
        <p>Here is your verification code for the Beyond Limits Learning Hub:</p>
        ${otpBlock(otp)}
        <p>To complete signing in:</p>
        <ol style="margin:8px 0 16px; padding-left:20px;">
          <li>Enter this verification code when prompted.</li>
          <li>To complete signing in enter this verification code when prompted.</li>
        </ol>
        <p>Once signed in, visit your profile page to create a new password and keep your account secure.</p>
        <p>Enjoy your learning journey!</p>
        <p>Beyond Limits Paediatric Therapy Team</p>
      `,
    }),
    attachments: logo ? [logo] : undefined,
  });
  return response;
}

export interface SendWelcomeEmailArgs {
  to: string;
  firstName?: string;
}

export async function sendWelcomeEmail({ to, firstName }: SendWelcomeEmailArgs) {
  const logo = getLogoAttachment();
  const greetName = extractFirstName(firstName, to);
  const response = await sendMailSafe({
    to,
    from: FROM_EMAIL,
    subject: "Welcome to Beyond Limits Learning Hub",
    html: renderEmailTemplate({
      title: "Welcome to Beyond Limits Learning Hub",
      body: `
        <p>Hi ${greetName},</p>
        <p>Welcome to our new app for Beyond Limits Paediatric Therapy!</p>
        <p>You'll receive a separate email with a verification code after you sign in.</p>
        <p>To finish signing up:</p>
        <ol style="margin:8px 0 16px; padding-left:20px;">
          <li>Log in with your new account details.</li>
          <li>When prompted, enter the verification code from the separate email.</li>
        </ol>
        <p>Once signed in, visit your profile page to create a new password to keep your account secure.</p>
        <p>Enjoy your learning journey!</p>
        <p>Beyond Limits Paediatric Therapy Team</p>
      `,
    }),
    attachments: logo ? [logo] : undefined,
  });
  return response;
}

// Send password reset email that password has been reset
export async function sendPasswordResetSuccessEmail({
  email,
}: {
  email: string;
}) {
  const logo = getLogoAttachment();
  const response = await sendMailSafe({
    to: email,
    from: FROM_EMAIL,
    subject: "Your Password Was Reset Successfully",
    html: renderEmailTemplate({
      title: "Password Reset Successful",
      body: `
        <p>Your password has been reset successfully. If you didn’t request this change, please contact support immediately.</p>
      `,
    }),
    attachments: logo ? [logo] : undefined,
  });
  return response;
}

//Send account credentials email to user
export async function sendAccountCredentialsEmail({
  to,
  username,
  password,
  firstName,
}: {
  to: string;
  username: string;
  password: string;
  firstName?: string;
}) {
  const logo = getLogoAttachment();
  const greetName = extractFirstName(firstName, to);
  const response = await sendMailSafe({
    to,
    from: FROM_EMAIL,
    subject: "Your Account Credentials — Beyond Limits Learning Hub",
    html: renderEmailTemplate({
      title: "Welcome to Beyond Limits Learning Hub",
      body: `
        <p>Hi ${greetName},</p>
        <p>Welcome to our new app for Beyond Limits Paediatric Therapy! Below are your login details to sign in:</p>
        <div style="margin:16px 0; padding:12px 16px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px;">
          <p style="margin:0;"><strong>Username:</strong> ${username}</p>
          <p style="margin:8px 0 0;"><strong>Password:</strong> ${password}</p>
        </div>
        <p>You'll receive a separate email with a verification code after you sign in.</p>
        <p>To sign in:</p>
        <ol style="margin:8px 0 16px; padding-left:20px;">
          <li>Log in with the details above.</li>
          <li>When prompted, enter the verification code from the separate email.</li>
          <li>Use the same login details to sign in again.</li>
        </ol>
        <p>Once signed in, visit your profile page to create a new password to keep your account secure.</p>
        <p>Enjoy your learning journey!</p>
        <p>Beyond Limits Paediatric Therapy Team</p>
      `,
    }),
    attachments: logo ? [logo] : undefined,
  });
  return response;
}

export interface SupportTicketAlertPayload {
  subject: string;
  type: string;
  currentStatus: string;
  id: string;
  userName: string;
  userEmail: string;
  userId: string;
  description: string;
  imageUrl?: string;
}

export async function sendSupportTicketAlertEmail({ to, payload }: { to: string; payload: SupportTicketAlertPayload }) {
  const logo = getLogoAttachment();
  const title = `New Support Ticket`;
  const imageSection = payload.imageUrl
    ? `<p><strong>Image:</strong> <a href="${payload.imageUrl}" target="_blank" rel="noopener noreferrer">View attachment</a></p>`
    : "";
  const body = `
    <p><strong>Subject:</strong> ${payload.subject}</p>
    <p><strong>Type:</strong> ${payload.type}</p>
    <p><strong>Status:</strong> ${payload.currentStatus}</p>
    <p><strong>Ticket ID:</strong> ${payload.id}</p>
    <p><strong>User:</strong> ${payload.userName} (${payload.userEmail})</p>
    <p><strong>User ID:</strong> ${payload.userId}</p>
    <p><strong>Description:</strong></p>
    <div style="white-space:pre-wrap;">${payload.description}</div>
    ${imageSection}
  `;
  const response = await sendMailSafe({
    to,
    from: FROM_EMAIL,
    subject: `New Support Ticket: ${payload.subject}`,
    html: renderEmailTemplate({ title, body }),
    attachments: logo ? [logo] : undefined,
  });
  return response;
}

export interface SendLearningAssignmentEmailArgs {
  to: string;
  firstName?: string;
  learningTitle: string;
  assignedByName?: string;
}

export async function sendLearningAssignmentEmail({
  to,
  firstName,
  learningTitle,
  assignedByName,
}: SendLearningAssignmentEmailArgs) {
  const logo = getLogoAttachment();
  const greetName = extractFirstName(firstName, to);
  const subject = "New learning assigned — Beyond Limits Learning Hub";
  const body = `
    <p>Hi ${greetName},</p>
    <p>You have been assigned the following learning in the Beyond Limits Learning Hub:</p>
    <p><strong>Learning:</strong> ${learningTitle}</p>
    <p><strong>Assigned by:</strong> ${assignedByName || ""}</p>
    <p>Sign in to start learning!</p>
    <p>Beyond Limits Paediatric Therapy Team</p>
  `;
  const response = await sendMailSafe({
    to,
    from: FROM_EMAIL,
    subject,
    html: renderEmailTemplate({ title: "New Learning Assigned", body }),
    attachments: logo ? [logo] : undefined,
  });
  return response;
}

