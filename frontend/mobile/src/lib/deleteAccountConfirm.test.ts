import { confirmWordMatches } from "./deleteAccountConfirm";

describe("confirmWordMatches", () => {
  it("requires the exact word before the delete button can enable", () => {
    expect(confirmWordMatches("ELIMINAR", "ELIMINAR")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(confirmWordMatches("eliminar", "ELIMINAR")).toBe(true);
    expect(confirmWordMatches("ElImInAr", "ELIMINAR")).toBe(true);
  });

  it("tolerates leading/trailing whitespace (autocomplete, hardware keyboard newline)", () => {
    expect(confirmWordMatches("  ELIMINAR  ", "ELIMINAR")).toBe(true);
    expect(confirmWordMatches("ELIMINAR\n", "ELIMINAR")).toBe(true);
  });

  it("rejects a near-miss — must never accidentally enable the destructive action", () => {
    expect(confirmWordMatches("ELIMINA", "ELIMINAR")).toBe(false);
    expect(confirmWordMatches("ELIMINARR", "ELIMINAR")).toBe(false);
    expect(confirmWordMatches("", "ELIMINAR")).toBe(false);
  });

  it("rejects the word typed in the wrong locale", () => {
    expect(confirmWordMatches("DELETE", "ELIMINAR")).toBe(false);
  });
});
