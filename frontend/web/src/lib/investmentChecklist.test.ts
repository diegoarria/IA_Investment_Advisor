import { describe, it, expect } from "vitest";
import {
  ChecklistItem,
  pendingChecklistItems,
  isChecklistComplete,
  checklistProgress,
} from "./investmentChecklist";

function item(item_key: string, checked: boolean): ChecklistItem {
  return { item_key, label: null, is_custom: false, checked };
}

describe("pendingChecklistItems", () => {
  it("returns only the unchecked items", () => {
    const items = [item("a", true), item("b", false), item("c", false)];
    expect(pendingChecklistItems(items).map((i) => i.item_key)).toEqual(["b", "c"]);
  });

  it("returns an empty array when everything is checked", () => {
    expect(pendingChecklistItems([item("a", true), item("b", true)])).toEqual([]);
  });
});

describe("isChecklistComplete", () => {
  it("is false when the list is empty (nothing to complete)", () => {
    expect(isChecklistComplete([])).toBe(false);
  });

  it("is false when at least one item is unchecked", () => {
    expect(isChecklistComplete([item("a", true), item("b", false)])).toBe(false);
  });

  it("is true only when every item is checked", () => {
    expect(isChecklistComplete([item("a", true), item("b", true)])).toBe(true);
  });
});

describe("checklistProgress", () => {
  it("counts checked vs total", () => {
    expect(checklistProgress([item("a", true), item("b", false), item("c", true)])).toEqual({
      checked: 2,
      total: 3,
    });
  });
});
