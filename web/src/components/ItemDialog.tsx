import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Item } from "@/lib/api";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  quantity: z.coerce.number().int().min(0).max(10_000),
});
type FormValues = z.infer<typeof schema>;

export type ItemDialogMode = { kind: "create" } | { kind: "edit"; item: Item };

export interface ItemDialogProps {
  open: boolean;
  mode: ItemDialogMode;
  onOpenChange: (open: boolean) => void;
}

export function ItemDialog({ open, mode, onOpenChange }: ItemDialogProps) {
  const queryClient = useQueryClient();

  const defaultValues: FormValues =
    mode.kind === "edit"
      ? { name: mode.item.name, quantity: mode.item.quantity }
      : { name: "", quantity: 0 };

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  useEffect(() => {
    form.reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode.kind === "edit" ? mode.item.id : null]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (mode.kind === "edit") {
        return api.updateItem(mode.item.id, values);
      }
      return api.createItem(values);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<Item[]>(["items"], (existing) => {
        const list = existing ?? [];
        if (mode.kind === "edit") {
          return list.map((item) => (item.id === saved.id ? saved : item));
        }
        return [...list, saved];
      });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="item-dialog-description">
        <DialogHeader>
          <DialogTitle>
            {mode.kind === "edit" ? "Edit item" : "Add item"}
          </DialogTitle>
          <DialogDescription id="item-dialog-description">
            {mode.kind === "edit"
              ? "Update the name or quantity."
              : "Provide a name and an initial quantity."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="item-name">Name</Label>
            <Input
              id="item-name"
              autoComplete="off"
              aria-invalid={form.formState.errors.name ? "true" : "false"}
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-quantity">Quantity</Label>
            <Input
              id="item-quantity"
              type="number"
              min={0}
              max={10000}
              aria-invalid={form.formState.errors.quantity ? "true" : "false"}
              {...form.register("quantity")}
            />
            {form.formState.errors.quantity && (
              <p role="alert" className="text-sm text-destructive">
                {form.formState.errors.quantity.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
