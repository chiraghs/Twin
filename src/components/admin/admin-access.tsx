"use client";

import { useEffect, useState } from "react";
import { KeyRound, Lock, LockOpen, ShieldAlert } from "lucide-react";
import { useAdmin } from "@/client/admin";
import { Badge, Button, Dialog, Input, Label } from "../ui/primitives";

/** Admin status chip with sign-in / sign-out. Admin unlocks camera sources and integration settings. */
export function AdminAccess() {
  const { admin, mode, loaded, load, signIn, signOut } = useAdmin();
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  if (!loaded) return null;
  if (mode === "open-local")
    return (
      <Badge tone="warning" title="Admin changes are open on this server.">
        <LockOpen className="h-3 w-3" /> Admin
      </Badge>
    );
  if (mode === "locked")
    return (
      <Badge tone="neutral" title="Admin changes are not enabled on this server.">
        <ShieldAlert className="h-3 w-3" /> Admin unavailable
      </Badge>
    );
  if (admin)
    return (
      <div className="flex items-center gap-2">
        <Badge tone="healthy">
          <LockOpen className="h-3 w-3" /> Admin unlocked
        </Badge>
        <Button size="xs" variant="ghost" onClick={() => void signOut()}>
          Lock
        </Button>
      </div>
    );

  const submit = async () => {
    setBusy(true);
    setError(null);
    const err = await signIn(passcode);
    setBusy(false);
    if (err) setError(err);
    else {
      setPasscode("");
      setOpen(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="admin-unlock">
        <Lock className="h-3.5 w-3.5" /> Unlock admin
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" /> Admin sign-in
          </span>
        }
        description="Admin can switch camera sources and change integration settings. Every change is written to the audit trail."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} disabled={!passcode} onClick={() => void submit()}>
              Unlock
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-1.5"
        >
          <Label htmlFor="admin-passcode">Passcode</Label>
          <Input id="admin-passcode" type="password" autoComplete="current-password" autoFocus value={passcode} onChange={(e) => setPasscode(e.target.value)} />
          {error && <p className="text-[12px] text-critical-ink">{error}</p>}
          <p className="text-[11.5px] text-muted">The session lasts 8 hours on this browser. Lock it when you're done.</p>
        </form>
      </Dialog>
    </>
  );
}
