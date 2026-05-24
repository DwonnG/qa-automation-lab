import { useState } from "react";

import { DashboardLink } from "@/components/DashboardLink";
import { DefectsPanel } from "@/components/DefectsPanel";
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
        <DefectsPanel />
        <LoginForm onAuthenticated={setTokenState} />
      </>
    );
  }

  return (
    <>
      <DashboardLink />
      <DefectsPanel />
      {/* pt-16 leaves clearance for the fixed DashboardLink (top-left)
          and DefectsPanel (top-right) floating chrome that only render
          on the Pages build (VITE_USE_MOCKS=true). At lg+ the viewport
          is wide enough that max-w-3xl leaves side margins big enough
          for both floats to clear the header, so we restore the
          original p-6 top padding. */}
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 pb-6 pt-16 lg:pt-6">
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
