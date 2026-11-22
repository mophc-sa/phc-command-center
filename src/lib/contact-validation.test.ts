import { expect, test } from "bun:test";
import { contactFieldError } from "./contact-validation";

test("refuses an email without a proper domain ending", () => {
  expect(contactFieldError("ali@company", "", false)).not.toBeNull();
  expect(contactFieldError("ali company.com", "", false)).not.toBeNull();
  expect(contactFieldError("ali@company.com", "", false)).toBeNull();
});

test("refuses a short mobile and accepts a Saudi one", () => {
  expect(contactFieldError("", "0551", false)).not.toBeNull();
  expect(contactFieldError("", "0551234567", false)).toBeNull();
  expect(contactFieldError("", "", false)).toBeNull();
});
