import { describe, it, expect } from "vitest";
import { renderTemplate, whatsappLink, telLink } from "./whatsapp";

describe("renderTemplate", () => {
  it("substitutes the documented variables", () => {
    expect(renderTemplate("Hi {{first_name}} at {{company}}", {
      first_name: "Karim", company: "Nile Dental",
    })).toBe("Hi Karim at Nile Dental");
  });

  it("derives first_name from a full name when given one", () => {
    expect(renderTemplate("Hi {{first_name}}", { name: "Karim Adel" })).toBe("Hi Karim");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("Hi {{ first_name }}", { first_name: "Karim" })).toBe("Hi Karim");
  });

  it("drops unknown and empty variables rather than printing the token", () => {
    // Sending a literal "{{category}}" to a prospect is worse than sending nothing.
    expect(renderTemplate("Hi{{ nope }}", {})).toBe("Hi");
    expect(renderTemplate("A {{company}} B", { company: null })).toBe("A  B");
  });

  it("leaves a template with no variables untouched", () => {
    expect(renderTemplate("Plain text", {})).toBe("Plain text");
  });
});

describe("whatsappLink", () => {
  it("strips the plus and encodes the message", () => {
    expect(whatsappLink("+971501234567", "Hi there"))
      .toBe("https://wa.me/971501234567?text=Hi%20there");
  });

  it("encodes newlines and ampersands so the text is not truncated", () => {
    const link = whatsappLink("+201012345678", "Line one\nLine two & more");
    expect(link).toContain("%0A");
    expect(link).toContain("%26");
    expect(link).not.toContain("\n");
  });

  it("tolerates spaces and dashes in the number", () => {
    expect(whatsappLink("+971 50 123-4567", "hi"))
      .toBe("https://wa.me/971501234567?text=hi");
  });

  it("omits the text parameter for an empty message", () => {
    expect(whatsappLink("+971501234567", "")).toBe("https://wa.me/971501234567");
  });
});

describe("telLink", () => {
  it("builds a tel: URI keeping the plus", () => {
    expect(telLink("+971 50 123 4567")).toBe("tel:+971501234567");
  });
});
