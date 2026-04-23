import sgMail from "@sendgrid/mail";

if (!process.env.SENDGRID_API_KEY) {
  throw new Error("SENDGRID_API_KEY missing");
}

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export { sgMail };