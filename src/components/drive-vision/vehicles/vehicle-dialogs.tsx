"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFleet } from "@/features/drive-vision/store/fleet-store";
import { groupService, vehicleService } from "@/features/drive-vision/services/vehicle-service";
import { ServiceError } from "@/features/drive-vision/services/core";
import { CURRENT_USER_ID } from "@/features/drive-vision/mock-data/seed";
import { FormField, fieldA11y } from "../shared/form-field";
import { toast } from "../shared/toast-provider";
import { useReturnFocus } from "../shared/use-return-focus";

/** Sell / move devices to another user's group (vendor 1.9 transferVehicle). */
export function TransferDialog({ open, onOpenChange, vehicleIds, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; vehicleIds: string[]; onDone?: () => void }) {
  const groups = useFleet((s) => s.groups);
  const users = useFleet((s) => s.users);
  const vehicles = useFleet((s) => s.vehicles);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const moving = vehicles.filter((v) => vehicleIds.includes(v.vehicleId));
  const fromGroups = [...new Set(moving.map((v) => groups.find((g) => g.groupId === v.groupId)?.groupName ?? "—"))];
  const targetGroup = groups.find((g) => g.groupId === target);
  const targetUser = users.find((u) => u.userId === targetGroup?.userId);

  async function submit() {
    if (!target) {
      setError("Choose a destination group.");
      return;
    }
    setBusy(true);
    try {
      const g = await vehicleService.transferVehicles(vehicleIds, target);
      toast.success(`${vehicleIds.length} vehicle${vehicleIds.length === 1 ? "" : "s"} moved to ${g.groupName}`, { description: "Local demo change only — no devices were transferred." });
      onOpenChange(false);
      setTarget("");
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  const restoreFocus = useReturnFocus(open);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={restoreFocus}>
        <DialogHeader>
          <DialogTitle>Transfer {vehicleIds.length === 1 ? "vehicle" : `${vehicleIds.length} vehicles`}</DialogTitle>
          <DialogDescription>Move devices to another group. If the group belongs to a different user, ownership moves too.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl bg-surface-muted px-3 py-2.5 text-[13px]">
            <p className="text-xs text-ink-muted">From</p>
            <p className="font-medium">{fromGroups.join(", ") || "—"}</p>
            <p className="mt-1 truncate text-xs text-ink-muted">{moving.map((v) => v.vehicleName).join(", ")}</p>
          </div>
          <FormField id="transfer-group" label="Destination group" required error={error}>
            <Select
              value={target}
              onValueChange={(v) => {
                setTarget(v);
                setError(undefined);
              }}
            >
              <SelectTrigger {...fieldA11y("transfer-group", error)} className="w-full">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                {users
                  .filter((u) => groups.some((g) => g.userId === u.userId))
                  .map((u) => (
                    <SelectGroup key={u.userId}>
                      <SelectLabel>{u.userName}</SelectLabel>
                      {groups
                        .filter((g) => g.userId === u.userId)
                        .map((g) => (
                          <SelectItem key={g.groupId} value={g.groupId}>
                            {g.groupName}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))}
              </SelectContent>
            </Select>
          </FormField>
          {targetGroup ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-muted">
              {fromGroups.join(", ")} <ArrowRight className="size-3.5" /> <span className="font-medium text-ink">{targetGroup.groupName}</span> · owner {targetUser?.userName}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Create a group (vendor 2.1 /group/add). */
export function NewGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const users = useFleet((s) => s.users);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(CURRENT_USER_ID);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter a group name.");
      return;
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email or leave it blank.");
      return;
    }
    setBusy(true);
    try {
      const g = await groupService.createGroup({ groupName: name, userId: owner, email: email || undefined });
      toast.success(`Group “${g.groupName}” created`);
      setName("");
      setEmail("");
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ServiceError) setError(err.message);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  const restoreFocus = useReturnFocus(open);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={restoreFocus}>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>Groups organise devices under a user account.</DialogDescription>
          </DialogHeader>
          <FormField id="ng-name" label="Group name" required error={error}>
            <Input
              {...fieldA11y("ng-name", error)}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(undefined);
              }}
              placeholder="e.g. Airport Shuttles"
              autoFocus
            />
          </FormField>
          <FormField id="ng-owner" label="Owner account">
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger id="ng-owner" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {users
                  .filter((u) => u.role !== "Driver")
                  .map((u) => (
                    <SelectItem key={u.userId} value={u.userId}>
                      {u.userName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="ng-email" label="Contact email">
            <Input id="ng-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Create group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
