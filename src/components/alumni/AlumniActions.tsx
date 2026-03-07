"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { AddAlumniMenu } from "./AddAlumniMenu";
import { BulkLinkedInImporter } from "./BulkLinkedInImporter";

// ─── Context to decouple menu (in header) from panel (in body) ───────────────

interface ImporterContextValue {
  showImporter: boolean;
  openImporter: () => void;
  closeImporter: () => void;
}

const ImporterContext = createContext<ImporterContextValue>({
  showImporter: false,
  openImporter: () => {},
  closeImporter: () => {},
});

// Provider wraps the entire alumni page section
export function AlumniActionsProvider({ children }: { children: ReactNode }) {
  const [showImporter, setShowImporter] = useState(false);
  const openImporter = useCallback(() => setShowImporter(true), []);
  const closeImporter = useCallback(() => setShowImporter(false), []);

  return (
    <ImporterContext.Provider value={{ showImporter, openImporter, closeImporter }}>
      {children}
    </ImporterContext.Provider>
  );
}

// The split-button menu, rendered inside PageHeader actions
interface AlumniActionsMenuProps {
  orgSlug: string;
  actionLabel: string;
}

export function AlumniActionsMenu({ orgSlug, actionLabel }: AlumniActionsMenuProps) {
  const { openImporter } = useContext(ImporterContext);

  return (
    <AddAlumniMenu
      orgSlug={orgSlug}
      actionLabel={actionLabel}
      onImportClick={openImporter}
    />
  );
}

// The import panel, rendered in the page body between filters and grid
interface AlumniImportPanelProps {
  organizationId: string;
}

export function AlumniImportPanel({ organizationId }: AlumniImportPanelProps) {
  const { showImporter, closeImporter } = useContext(ImporterContext);

  if (!showImporter) return null;

  return (
    <BulkLinkedInImporter
      organizationId={organizationId}
      onClose={closeImporter}
    />
  );
}
