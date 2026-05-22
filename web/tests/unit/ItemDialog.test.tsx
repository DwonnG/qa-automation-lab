import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ItemDialog } from "@/components/ItemDialog";
import { api, type Item } from "@/lib/api";

import { renderWithQuery } from "../utils/renderWithQuery";

const existing: Item = { id: "1", name: "apples", quantity: 5 };

describe("ItemDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows empty fields in create mode", () => {
    renderWithQuery(
      <ItemDialog open mode={{ kind: "create" }} onOpenChange={vi.fn()} />,
    );

    expect(screen.getByRole("dialog")).toHaveAccessibleName(/add item/i);
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(0);
  });

  it("populates fields in edit mode", () => {
    renderWithQuery(
      <ItemDialog
        open
        mode={{ kind: "edit", item: existing }}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveAccessibleName(/edit item/i);
    expect(screen.getByLabelText(/name/i)).toHaveValue("apples");
    expect(screen.getByLabelText(/quantity/i)).toHaveValue(5);
  });

  it("calls createItem and closes on submit in create mode", async () => {
    const onOpenChange = vi.fn();
    const createSpy = vi
      .spyOn(api, "createItem")
      .mockResolvedValue({ id: "new", name: "pears", quantity: 3 });

    renderWithQuery(
      <ItemDialog open mode={{ kind: "create" }} onOpenChange={onOpenChange} />,
    );

    await userEvent.type(screen.getByLabelText(/name/i), "pears");
    await userEvent.clear(screen.getByLabelText(/quantity/i));
    await userEvent.type(screen.getByLabelText(/quantity/i), "3");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({ name: "pears", quantity: 3 });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("calls updateItem in edit mode", async () => {
    const onOpenChange = vi.fn();
    const updateSpy = vi
      .spyOn(api, "updateItem")
      .mockResolvedValue({ ...existing, quantity: 12 });

    renderWithQuery(
      <ItemDialog
        open
        mode={{ kind: "edit", item: existing }}
        onOpenChange={onOpenChange}
      />,
    );

    await userEvent.clear(screen.getByLabelText(/quantity/i));
    await userEvent.type(screen.getByLabelText(/quantity/i), "12");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith("1", {
        name: "apples",
        quantity: 12,
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("blocks submit when name is empty", async () => {
    const createSpy = vi.spyOn(api, "createItem");

    renderWithQuery(
      <ItemDialog open mode={{ kind: "create" }} onOpenChange={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/required/i);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
