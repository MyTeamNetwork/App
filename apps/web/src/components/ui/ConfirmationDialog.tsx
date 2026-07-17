"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "./Button";

export interface ConfirmationDialogCopy {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmationDialogProps extends ConfirmationDialogCopy {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
  title,
  description,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  destructive = false,
}: ConfirmationDialogProps) {
  return (
    // Cancel/Escape stay available even while pending so a hung request never
    // traps the user. Double-confirm is already prevented by the disabled
    // confirm button below.
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        {/* Flex-centering wrapper (matches Modal.tsx) so the enter/exit scale
            animation doesn't fight a translate-based centering transform. */}
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content className="modal-content relative w-full max-w-md rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl focus:outline-none">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
              {description}
            </Dialog.Description>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary">
                  {cancelLabel}
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                variant={destructive ? "danger" : "primary"}
                isLoading={isPending}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
