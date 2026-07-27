const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const clean = (value, maxLength = 500) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);

const escapeHtml = (value) =>
  clean(value, 4000).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });

const phoneLooksValid = (value) => /^[+\d][\d\s()-]{5,24}$/.test(value);

async function checkRateLimit(request, env) {
  if (!env.CONTACT_RATE_LIMITER || typeof env.CONTACT_RATE_LIMITER.limit !== "function") return null;

  const clientIp = clean(request.headers.get("cf-connecting-ip") || "unknown", 80);
  const { success } = await env.CONTACT_RATE_LIMITER.limit({ key: `contact:${clientIp}` });
  if (success) return null;

  return json(
    { ok: false, message: "Liiga palju päringuid. Palun oota minut ja proovi uuesti või helista 502 9187." },
    429,
  );
}

async function verifyTurnstile(formData, request, env) {
  if (!env.TURNSTILE_SECRET) {
    return { error: "Robotikontroll ei ole veel seadistatud. Palun helista 502 9187.", status: 503 };
  }

  const token = getField(formData, "cf-turnstile-response", 2048);
  if (!token) {
    return { error: "Palun kinnita robotikontroll ja proovi uuesti.", status: 400 };
  }

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const remoteIp = clean(request.headers.get("cf-connecting-ip") || "", 80);
  if (remoteIp) body.set("remoteip", remoteIp);

  const verifyFetch = typeof env.TURNSTILE_VERIFY_FETCH === "function" ? env.TURNSTILE_VERIFY_FETCH : fetch;
  let result;
  try {
    const response = await verifyFetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) throw new Error(`Turnstile vastas ${response.status}`);
    result = await response.json();
  } catch (error) {
    console.error("Turnstile verification failed", error);
    return {
      error: "Robotikontroll ei ole hetkel saadaval. Palun proovi uuesti või helista 502 9187.",
      status: 503,
    };
  }

  const expectedHostname = new URL(request.url).hostname;
  if (!result.success || result.action !== "contact" || result.hostname !== expectedHostname) {
    return { error: "Robotikontroll ebaõnnestus. Palun proovi uuesti.", status: 400 };
  }

  return { success: true };
}

function getField(formData, name, maxLength = 500) {
  const value = formData.get(name);
  return typeof value === "string" ? clean(value, maxLength) : "";
}

function validateSubmission(formData) {
  const fields = {
    problem: getField(formData, "problem", 2000),
    urgency: getField(formData, "urgency", 40),
    location: getField(formData, "location", 160),
    name: getField(formData, "name", 120),
    phone: getField(formData, "phone", 40),
    payer: getField(formData, "payer", 40),
    personalCode: getField(formData, "personalCode", 30),
    organisationName: getField(formData, "organisationName", 180),
    registryCode: getField(formData, "registryCode", 30),
    contactPerson: getField(formData, "contactPerson", 120),
    insurer: getField(formData, "insurer", 120),
    claimNumber: getField(formData, "claimNumber", 80),
  };

  const validUrgencies = new Set(["Kohe — avarii", "Täna", "Lähipäevil"]);
  const validPayers = new Set(["Mina ise", "Korteriühistu", "Kindlustus", "Ettevõte"]);

  if (!fields.problem || !fields.location || !fields.name || !fields.phone) {
    return { error: "Palun täida kõik kohustuslikud väljad." };
  }
  if (!validUrgencies.has(fields.urgency) || !validPayers.has(fields.payer)) {
    return { error: "Palun vali abi kiirus ja maksja." };
  }
  if (!phoneLooksValid(fields.phone)) {
    return { error: "Palun kontrolli telefoninumbrit." };
  }
  if (fields.payer === "Mina ise" && !fields.personalCode) {
    return { error: "Palun lisa arve ja lepingu jaoks isikukood." };
  }
  if (
    ["Korteriühistu", "Ettevõte"].includes(fields.payer) &&
    (!fields.organisationName || !fields.registryCode || !fields.contactPerson)
  ) {
    return { error: "Palun lisa organisatsiooni nimi, registrikood ja kontaktisik." };
  }
  if (fields.payer === "Kindlustus" && !fields.insurer) {
    return { error: "Palun lisa kindlustusseltsi nimi." };
  }

  return { fields };
}

function buildEmail(fields, request) {
  const payerDetails = [];
  if (fields.payer === "Mina ise") payerDetails.push(["Isikukood", fields.personalCode]);
  if (["Korteriühistu", "Ettevõte"].includes(fields.payer)) {
    payerDetails.push(
      ["Organisatsioon", fields.organisationName],
      ["Registrikood", fields.registryCode],
      ["Kontaktisik", fields.contactPerson],
    );
  }
  if (fields.payer === "Kindlustus") {
    payerDetails.push(["Kindlustusselts", fields.insurer]);
    if (fields.claimNumber) payerDetails.push(["Kahjunumber", fields.claimNumber]);
  }

  const rows = [
    ["Kiirus", fields.urgency],
    ["Mis juhtus", fields.problem],
    ["Asukoht", fields.location],
    ["Nimi", fields.name],
    ["Telefon", fields.phone],
    ["Maksja", fields.payer],
    ...payerDetails,
  ];

  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;vertical-align:top">${escapeHtml(label)}</th><td style="padding:8px;border-bottom:1px solid #ddd;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return {
    subject: `KIIRE ABI — ${fields.name}, ${fields.urgency}`,
    text: `${text}\n\nSaadetud: ${new Date().toISOString()}\nLeht: ${new URL(request.url).origin}`,
    html: `<h1 style="font:700 24px Arial,sans-serif;color:#1F4E79">Uus kiire abi päring</h1><table style="border-collapse:collapse;font:16px Arial,sans-serif">${htmlRows}</table><p style="font:13px Arial,sans-serif;color:#666">Saadetud ${escapeHtml(new Date().toISOString())}</p>`,
  };
}

async function handleContact(request, env) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, message: "Lisatud foto on liiga suur. Suurim lubatud maht on 4 MB." }, 413);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ ok: false, message: "Vigane päringu vorming." }, 415);
  }

  const rateLimitResponse = await checkRateLimit(request, env);
  if (rateLimitResponse) return rateLimitResponse;

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, message: "Päringut ei õnnestunud lugeda." }, 400);
  }

  if (getField(formData, "website", 200)) {
    return json({ ok: true });
  }

  const startedAt = Number(getField(formData, "startedAt", 20));
  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 2500) {
    return json({ ok: false, message: "Palun oota hetk ja proovi uuesti." }, 429);
  }

  const validated = validateSubmission(formData);
  if (validated.error) return json({ ok: false, message: validated.error }, 400);

  const turnstile = await verifyTurnstile(formData, request, env);
  if (turnstile.error) return json({ ok: false, message: turnstile.error }, turnstile.status);

  const photo = formData.get("photo");
  const attachments = [];
  if (photo && typeof photo !== "string" && photo.size > 0) {
    if (photo.size > MAX_ATTACHMENT_BYTES) {
      return json({ ok: false, message: "Foto on liiga suur. Suurim lubatud maht on 4 MB." }, 413);
    }
    if (!ALLOWED_IMAGE_TYPES.has(photo.type)) {
      return json({ ok: false, message: "Palun lisa JPG-, PNG-, WEBP- või HEIC-foto." }, 415);
    }
    attachments.push({
      content: await photo.arrayBuffer(),
      filename: clean(photo.name, 100) || "foto",
      type: photo.type,
      disposition: "attachment",
    });
  }

  if (!env.EMAIL || typeof env.EMAIL.send !== "function") {
    return json({ ok: false, message: "Vormi e-post ei ole veel seadistatud. Palun helista 502 9187." }, 503);
  }

  const email = buildEmail(validated.fields, request);
  try {
    await env.EMAIL.send({
      to: "info@remontteenus.ee",
      from: { email: "info@remontteenus.ee", name: "Remontteenus.ee veeb" },
      replyTo: "info@remontteenus.ee",
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments,
    });
    return json({ ok: true });
  } catch (error) {
    console.error("Contact email failed", error);
    return json({ ok: false, message: "Saatmine ei õnnestunud. Palun helista 502 9187 või kirjuta info@remontteenus.ee." }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contact") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS" } });
      }
      if (request.method !== "POST") {
        return json({ ok: false, message: "Lubatud on ainult POST-päring." }, 405);
      }
      return handleContact(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

export { buildEmail, clean, validateSubmission, verifyTurnstile };
