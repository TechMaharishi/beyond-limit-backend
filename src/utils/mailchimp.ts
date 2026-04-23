import crypto from "crypto";

export interface MailchimpSubscribeArgs {
  email: string;
  name?: string;
  tags?: string[];
}

function splitName(name?: string): { firstName?: string; lastName?: string } {
  const n = String(name || "").trim();
  if (!n) return {};
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ") || undefined;
  return { firstName, lastName };
}

function getEnv() {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  const server = process.env.MAILCHIMP_SERVER_PREFIX;
  const listId = process.env.MAILCHIMP_LIST_ID;
  const doubleOptInRaw = process.env.MAILCHIMP_DOUBLE_OPTIN;
  const doubleOptIn = String(doubleOptInRaw || "").toLowerCase() === "true";
  return { apiKey, server, listId, doubleOptIn };
}

async function putMember({
  email,
  name,
  status,
}: {
  email: string;
  name?: string;
  status: "subscribed" | "pending";
}) {
  const { apiKey, server, listId } = getEnv();
  if (!apiKey || !server || !listId) return { ok: false, skipped: true };
  const emailLower = email.trim().toLowerCase();
  const subscriberHash = crypto.createHash("md5").update(emailLower).digest("hex");
  const { firstName, lastName } = splitName(name);
  const url = `https://${server}.api.mailchimp.com/3.0/lists/${listId}/members/${subscriberHash}`;
  const auth = Buffer.from(`anystring:${apiKey}`).toString("base64");
  const body = {
    email_address: emailLower,
    status_if_new: status,
    status,
    merge_fields: {
      FNAME: firstName || "",
      LNAME: lastName || "",
    },
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const ok = res.status >= 200 && res.status < 300;
  return { ok, status: res.status };
}

async function postTags({
  email,
  tags,
}: {
  email: string;
  tags: string[];
}) {
  const { apiKey, server, listId } = getEnv();
  if (!apiKey || !server || !listId) return { ok: false, skipped: true };
  if (!tags || tags.length === 0) return { ok: true };
  const emailLower = email.trim().toLowerCase();
  const subscriberHash = crypto.createHash("md5").update(emailLower).digest("hex");
  const url = `https://${server}.api.mailchimp.com/3.0/lists/${listId}/members/${subscriberHash}/tags`;
  const auth = Buffer.from(`anystring:${apiKey}`).toString("base64");
  const body = {
    tags: tags.map((t) => ({ name: t, status: "active" })),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const ok = res.status >= 200 && res.status < 300;
  return { ok, status: res.status };
}

export async function subscribeEmailToMailchimp(args: MailchimpSubscribeArgs) {
  const { email, name, tags } = args;
  const { doubleOptIn } = getEnv();
  const status: "subscribed" | "pending" = doubleOptIn ? "pending" : "subscribed";
  const putRes = await putMember({ email, name, status });
  if (!putRes.ok && !("skipped" in putRes)) {
    return false;
  }
  if (Array.isArray(tags) && tags.length > 0) {
    await postTags({ email, tags });
  }
  return true;
}

export async function subscribeEmailToMailchimpSafe(args: MailchimpSubscribeArgs) {
  try {
    return await subscribeEmailToMailchimp(args);
  } catch {
    return false;
  }
}
