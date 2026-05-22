import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type Item } from "@/lib/api";

export interface ItemsTableProps {
  onEdit: (item: Item) => void;
}

export function ItemsTable({ onEdit }: ItemsTableProps) {
  const queryClient = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: ["items"],
    queryFn: () => api.listItems(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteItem(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Item[]>(["items"], (existing) =>
        (existing ?? []).filter((item) => item.id !== id),
      );
    },
  });

  if (itemsQuery.isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        Loading items...
      </div>
    );
  }

  if (itemsQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load items.
      </p>
    );
  }

  const items = itemsQuery.data;

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No items yet. Add your first one.
      </div>
    );
  }

  return (
    <Table>
      <caption className="sr-only">Items in your inventory</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Name</TableHead>
          <TableHead scope="col">Quantity</TableHead>
          <TableHead scope="col" className="text-right">
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id} data-testid={`item-row-${item.id}`}>
            <TableCell>{item.name}</TableCell>
            <TableCell>{item.quantity}</TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(item)}
                  aria-label={`Edit ${item.name}`}
                >
                  Edit
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteMutation.mutate(item.id)}
                  aria-label={`Delete ${item.name}`}
                  disabled={deleteMutation.isPending}
                >
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
