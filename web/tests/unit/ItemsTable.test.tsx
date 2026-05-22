import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ItemsTable } from "@/components/ItemsTable";
import { api, type Item } from "@/lib/api";

import { renderWithQuery } from "../utils/renderWithQuery";

const sampleItems: Item[] = [
  { id: "1", name: "apples", quantity: 5 },
  { id: "2", name: "bananas", quantity: 9 },
];

describe("ItemsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an empty state when no items exist", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue([]);

    renderWithQuery(<ItemsTable onEdit={vi.fn()} />);

    expect(await screen.findByText(/no items yet/i)).toBeInTheDocument();
  });

  it("renders a row per item", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue(sampleItems);

    renderWithQuery(<ItemsTable onEdit={vi.fn()} />);

    expect(
      await screen.findByRole("cell", { name: "apples" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "bananas" })).toBeInTheDocument();
  });

  it("invokes onEdit with the clicked item", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue(sampleItems);
    const onEdit = vi.fn();

    renderWithQuery(<ItemsTable onEdit={onEdit} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /edit apples/i }),
    );

    expect(onEdit).toHaveBeenCalledWith(sampleItems[0]);
  });

  it("removes a row from the cache after delete", async () => {
    vi.spyOn(api, "listItems").mockResolvedValue(sampleItems);
    const deleteSpy = vi
      .spyOn(api, "deleteItem")
      .mockResolvedValue(undefined as never);

    renderWithQuery(<ItemsTable onEdit={vi.fn()} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /delete apples/i }),
    );

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("1");
      expect(
        screen.queryByRole("cell", { name: "apples" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows a loading state while items are pending", () => {
    vi.spyOn(api, "listItems").mockImplementation(
      () => new Promise<Item[]>(() => undefined),
    );

    renderWithQuery(<ItemsTable onEdit={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });
});
