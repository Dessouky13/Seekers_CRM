import { describe, it, expect } from "vitest";
import { normalisePhone, classifyPhone, describePhone, phoneFields } from "./phone";

describe("normalisePhone", () => {
  it("strips formatting from an international number", () => {
    expect(normalisePhone("+971 50 123 4567")).toBe("+971501234567");
    expect(normalisePhone("+20 10 12345678")).toBe("+201012345678");
    expect(normalisePhone("+1 555-123-4567")).toBe("+15551234567");
  });

  it("treats the North-American bracket shape as +1", () => {
    // 130 production leads are stored exactly like this, with no country code.
    expect(normalisePhone("(212) 285-1110")).toBe("+12122851110");
    expect(normalisePhone("(801) 748-1600")).toBe("+18017481600");
  });

  it("accepts 10 bare digits with a valid US area code as +1", () => {
    expect(normalisePhone("2122851110")).toBe("+12122851110");
  });

  it("refuses to guess a country when there is no code", () => {
    // Guessing would silently mangle a list spanning five Gulf dialling codes.
    expect(normalisePhone("0123456789")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
  });

  it("returns null for junk and empty input", () => {
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("   ")).toBeNull();
    expect(normalisePhone("n/a")).toBeNull();
    expect(normalisePhone("no phone")).toBeNull();
  });

  it("is idempotent", () => {
    const once = normalisePhone("+971 50 123 4567");
    expect(normalisePhone(once)).toBe(once);
  });

  it("handles a leading 00 international prefix", () => {
    expect(normalisePhone("00971501234567")).toBe("+971501234567");
  });
});

describe("classifyPhone", () => {
  it("classifies UAE mobiles and landlines", () => {
    expect(classifyPhone("+971501234567")).toBe("mobile");
    expect(classifyPhone("+971521234567")).toBe("mobile");
    expect(classifyPhone("+971581234567")).toBe("mobile");
    expect(classifyPhone("+97141234567")).toBe("landline");
    expect(classifyPhone("+97121234567")).toBe("landline");
  });

  it("classifies Egyptian mobiles and landlines", () => {
    expect(classifyPhone("+201012345678")).toBe("mobile");
    expect(classifyPhone("+201112345678")).toBe("mobile");
    expect(classifyPhone("+201212345678")).toBe("mobile");
    expect(classifyPhone("+201512345678")).toBe("mobile");
    expect(classifyPhone("+20212345678")).toBe("landline");   // Cairo
    expect(classifyPhone("+20312345678")).toBe("landline");   // Alexandria
  });

  it("classifies the rest of the Gulf", () => {
    expect(classifyPhone("+966551234567")).toBe("mobile");
    expect(classifyPhone("+966112345678")).toBe("landline");
    expect(classifyPhone("+97433123456")).toBe("mobile");
    expect(classifyPhone("+97444123456")).toBe("landline");
    expect(classifyPhone("+962791234567")).toBe("mobile");
    expect(classifyPhone("+962612345678")).toBe("landline");
  });

  it("classifies European mobiles", () => {
    expect(classifyPhone("+447911123456")).toBe("mobile");
    expect(classifyPhone("+33612345678")).toBe("mobile");
    expect(classifyPhone("+31612345678")).toBe("mobile");
    expect(classifyPhone("+41791234567")).toBe("mobile");
  });

  it("returns unknown for +1, where mobile and landline share the numbering space", () => {
    expect(classifyPhone("+12122851110")).toBe("unknown");
    expect(classifyPhone("+14155551234")).toBe("unknown");
  });

  it("returns unknown for null and unrecognised country codes", () => {
    expect(classifyPhone(null)).toBe("unknown");
    expect(classifyPhone("+9991234567")).toBe("unknown");
  });
});

describe("describePhone", () => {
  it("labels a mobile with its country and prefix", () => {
    expect(describePhone("+971501234567")).toBe("mobile · +971 5x");
  });

  it("labels a landline plainly", () => {
    expect(describePhone("+97141234567")).toBe("landline");
  });

  it("says so when the type cannot be determined", () => {
    expect(describePhone("+12122851110")).toBe("US/Canada — type unknown");
  });

  it("handles null", () => {
    expect(describePhone(null)).toBe("no number");
  });
});

describe("phoneFields", () => {
  it("derives all three fields from a valid international mobile", () => {
    // Would FAIL if phoneE164 were the raw string: the raw has spaces, the
    // stored E.164 must not.
    expect(phoneFields("+20 100 555 1234")).toEqual({
      phone:     "+20 100 555 1234",
      phoneE164: "+201005551234",
      phoneType: "mobile",
    });
  });

  it("derives all three fields from a valid landline", () => {
    // Cairo landline: "20" (Egypt) + "2" (Cairo) + local number.
    expect(phoneFields("+20 2 1234 5678")).toEqual({
      phone:     "+20 2 1234 5678",
      phoneE164: "+20212345678",
      phoneType: "landline",
    });
  });

  it("keeps the raw text but nulls e164/type for an unparseable number", () => {
    // No country code — normalisePhone deliberately refuses to guess one.
    // The raw digits are real data a human should still be able to see and
    // fix, so they must not be discarded.
    expect(phoneFields("0123456789")).toEqual({
      phone:     "0123456789",
      phoneE164: null,
      phoneType: null,
    });
  });

  it("returns all-null for null, undefined and blank input", () => {
    expect(phoneFields(null)).toEqual({ phone: null, phoneE164: null, phoneType: null });
    expect(phoneFields(undefined)).toEqual({ phone: null, phoneE164: null, phoneType: null });
    expect(phoneFields("")).toEqual({ phone: null, phoneE164: null, phoneType: null });
    expect(phoneFields("   ")).toEqual({ phone: null, phoneE164: null, phoneType: null });
  });

  it("normalises the NANP bracket shape, and reports 'unknown' rather than null since it IS a usable E.164 number", () => {
    // This must not be confused with the unparseable case above: +1 has a
    // real, dialable E.164 form, just an unclassifiable one (see classifyPhone).
    expect(phoneFields("(212) 285-1110")).toEqual({
      phone:     "(212) 285-1110",
      phoneE164: "+12122851110",
      phoneType: "unknown",
    });
  });
});
