import assert from "node:assert/strict";
import test from "node:test";
import worker, { clean, validateSubmission, verifyTurnstile } from "../src/worker.js";

const validForm = () => {
  const form = new FormData();
  form.set("problem", "Vannitoas lekib kraan");
  form.set("urgency", "Täna");
  form.set("location", "Mustamäe");
  form.set("name", "Mari");
  form.set("phone", "+372 5555 5555");
  form.set("payer", "Mina ise");
  form.set("personalCode", "TESTKOOD");
  form.set("cf-turnstile-response", "test-token");
  form.set("startedAt", String(Date.now() - 5000));
  return form;
};

test("clean removes control characters and limits length", () => {
  assert.equal(clean("  tere\u0000\n", 20), "tere");
  assert.equal(clean("abcdef", 3), "abc");
});

test("validation accepts a complete private-customer request", () => {
  const result = validateSubmission(validForm());
  assert.equal(result.error, undefined);
  assert.equal(result.fields.name, "Mari");
});

test("validation rejects an invalid phone", () => {
  const form = validForm();
  form.set("phone", "abc");
  assert.equal(validateSubmission(form).error, "Palun kontrolli telefoninumbrit.");
});

test("contact endpoint sends one email", async () => {
  const sent = [];
  const request = new Request("https://remontteenus.ee/api/contact", {
    method: "POST",
    body: validForm(),
  });
  const response = await worker.fetch(request, {
    EMAIL: { send: async (message) => sent.push(message) },
    TURNSTILE_SECRET: "test-secret",
    TURNSTILE_VERIFY_FETCH: async () =>
      Response.json({ success: true, hostname: "remontteenus.ee", action: "contact" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Mari, Täna/);
});

test("contact endpoint rejects a missing Turnstile token", async () => {
  const form = validForm();
  form.delete("cf-turnstile-response");
  const response = await worker.fetch(
    new Request("https://remontteenus.ee/api/contact", { method: "POST", body: form }),
    { TURNSTILE_SECRET: "test-secret" },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /robotikontroll/i);
});

test("Turnstile validation rejects a token for another hostname", async () => {
  const result = await verifyTurnstile(
    validForm(),
    new Request("https://remontteenus.ee/api/contact"),
    {
      TURNSTILE_SECRET: "test-secret",
      TURNSTILE_VERIFY_FETCH: async () =>
        Response.json({ success: true, hostname: "example.com", action: "contact" }),
    },
  );
  assert.equal(result.status, 400);
});

test("contact endpoint rate limits repeated submissions", async () => {
  const response = await worker.fetch(
    new Request("https://remontteenus.ee/api/contact", { method: "POST", body: validForm() }),
    { CONTACT_RATE_LIMITER: { limit: async () => ({ success: false }) } },
  );
  assert.equal(response.status, 429);
});

test("non-POST contact requests are rejected", async () => {
  const response = await worker.fetch(new Request("https://remontteenus.ee/api/contact"), {});
  assert.equal(response.status, 405);
});
