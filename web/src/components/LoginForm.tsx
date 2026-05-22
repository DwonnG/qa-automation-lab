import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { setToken } from "@/lib/auth";

const schema = z.object({
  pin: z
    .string()
    .length(6, "PIN must be 6 digits")
    .regex(/^\d{6}$/u, "PIN must be 6 digits"),
});
type FormValues = z.infer<typeof schema>;

interface LoginFormProps {
  onAuthenticated: (token: string) => void;
}

export function LoginForm({ onAuthenticated }: LoginFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { pin: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => api.login(values.pin),
    onSuccess: ({ token }) => {
      setToken(token);
      onAuthenticated(token);
    },
  });

  const errorMessage =
    mutation.error instanceof ApiError
      ? "Invalid PIN. Please try again."
      : mutation.error
        ? "Something went wrong. Please try again."
        : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Enter the 6-digit demo PIN to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="pin">PIN</Label>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-invalid={form.formState.errors.pin ? "true" : "false"}
                {...form.register("pin")}
              />
              {form.formState.errors.pin && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.pin.message}
                </p>
              )}
              {errorMessage && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage}
                </p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending || form.formState.isSubmitting}
            >
              {mutation.isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
