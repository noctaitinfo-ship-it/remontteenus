import assert from "node:assert/strict";
import test from "node:test";
import worker, { clean, validateSubmission } from "../src/worker.js";

const validForm = () => {
  const form = new FormData();
  form.set("problem", "Vannitoas lekib kraan");
  form.set("urgency", "Täna");
  form.set("location", "Mustamäe");
  form.set("name", "Mari");
  form.set("phone", "+372 5555 5555");
  form.set("payer", "Mina ise");
  form.set("personalCode", "TESTKOOD");
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
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Mari, Täna/);
});

test("non-POST contact requests are rejected", async () => {
  const response = await worker.fetch(new Request("https://remontteenus.ee/api/contact"), {});
  assert.equal(response.status, 405);
});
