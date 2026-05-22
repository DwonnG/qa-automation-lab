import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/LoginForm";
import { ApiError, api } from "@/lib/api";
import { getToken } from "@/lib/auth";

import { renderWithQuery } from "../utils/renderWithQuery";

describe("LoginForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders pin field and submit button", () => {
    renderWithQuery(<LoginForm onAuthenticated={vi.fn()} />);

    expect(screen.getByLabelText(/PIN/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it("blocks submit when PIN is too short", async () => {
    const onAuthenticated = vi.fn();
    const loginSpy = vi.spyOn(api, "login");
    renderWithQuery(<LoginForm onAuthenticated={onAuthenticated} />);

    await userEvent.type(screen.getByLabelText(/PIN/i), "123");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/6 digits/i);
    expect(loginSpy).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("calls onAuthenticated and persists token on success", async () => {
    const onAuthenticated = vi.fn();
    vi.spyOn(api, "login").mockResolvedValue({ token: "tok-abc" });

    renderWithQuery(<LoginForm onAuthenticated={onAuthenticated} />);

    await userEvent.type(screen.getByLabelText(/PIN/i), "000000");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledWith("tok-abc");
    });
    expect(getToken()).toBe("tok-abc");
  });

  it("shows a generic error on 401", async () => {
    vi.spyOn(api, "login").mockRejectedValue(
      new ApiError("invalid credentials", 401, null),
    );

    renderWithQuery(<LoginForm onAuthenticated={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/PIN/i), "000000");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/invalid pin/i)).toBeInTheDocument();
  });
});
