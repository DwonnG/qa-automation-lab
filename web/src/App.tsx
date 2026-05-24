import { useState } from "react";

import { DashboardLink } from "@/components/DashboardLink";
import { ItemDialog, type ItemDialogMode } from "@/components/ItemDialog";
import { ItemsTable } from "@/components/ItemsTable";
import { LoginForm } from "@/components/LoginForm";
import { Button } from "@/components/ui/button";
import { clearToken, getToken } from "@/lib/auth";

export function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [dialogMode, setDialogMode] = useState<ItemDialogMode | null>(null);

  if (!token) {
    return (
      <>
        <DashboardLink />
        <LoginForm onAuthenticated={setTokenState} />
      </>
    );
  }

  return (
    <>
      <DashboardLink />
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Items</h1>
            <p className="text-sm text-muted-foreground">
              Manage your demo inventory.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setDialogMode({ kind: "create" })}>
              Add item
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                clearToken();
                setTokenState(null);
              }}
            >
              Sign out
            </Button>
          </div>
        </header>

        <ItemsTable onEdit={(item) => setDialogMode({ kind: "edit", item })} />

        {dialogMode && (
          <ItemDialog
            open
            mode={dialogMode}
            onOpenChange={(open) => {
              if (!open) {
                setDialogMode(null);
              }
            }}
          />
        )}
      </main>
    </>
  );
}
