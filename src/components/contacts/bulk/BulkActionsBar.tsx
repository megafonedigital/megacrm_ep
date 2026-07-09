import { useState } from "react";
import { Tag, ListTodo, GitBranch, Zap, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BulkApplyTagDialog } from "./BulkApplyTagDialog";
import { BulkSetFieldDialog } from "./BulkSetFieldDialog";
import { BulkAddToPipelineDialog } from "./BulkAddToPipelineDialog";
import { BulkAutomationDialog } from "./BulkAutomationDialog";
import type { BulkContext } from "./types";

interface Props {
  ctx: BulkContext;
  /** Whether the user has elected "select all filtered" beyond the current page. */
  allFilteredMode: boolean;
  pageSelectedCount: number;
  totalFilteredCount: number;
  pageSize: number;
  canSelectAllFiltered: boolean;
  onClear: () => void;
  onSelectAllFiltered: () => void;
  onAfterAction: () => void;
  /** Admin-only delete handler. */
  canDelete: boolean;
  isDeleting: boolean;
  onConfirmDelete: () => void;
}

export function BulkActionsBar({
  ctx, allFilteredMode, pageSelectedCount, totalFilteredCount, pageSize,
  canSelectAllFiltered, onClear, onSelectAllFiltered, onAfterAction,
  canDelete, isDeleting, onConfirmDelete,
}: Props) {
  const [tagOpen, setTagOpen] = useState(false);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 bg-muted/50 border rounded-md px-3 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm">
          {allFilteredMode ? (
            <span><strong>{totalFilteredCount}</strong> contato(s) filtrados selecionados.</span>
          ) : (
            <span><strong>{pageSelectedCount}</strong> selecionado(s) nesta página.</span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setTagOpen(true)}>
            <Tag className="h-4 w-4 mr-1.5" />Aplicar tag
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFieldOpen(true)}>
            <ListTodo className="h-4 w-4 mr-1.5" />Definir campo
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPipelineOpen(true)}>
            <GitBranch className="h-4 w-4 mr-1.5" />Adicionar em pipeline
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAutomationOpen(true)}>
            <Zap className="h-4 w-4 mr-1.5" />Disparar automação
          </Button>
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" disabled={isDeleting}>
                  {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
                  Excluir
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir {ctx.count} contato(s)?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação remove os contatos e todas as conversas, mensagens e eventos relacionados. Não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onConfirmDelete}>Excluir</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button size="sm" variant="ghost" onClick={onClear}>Limpar</Button>
        </div>
      </div>
      {canSelectAllFiltered && !allFilteredMode && pageSelectedCount >= pageSize && totalFilteredCount > pageSelectedCount && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          Todos os {pageSelectedCount} desta página estão selecionados.
          <Button size="sm" variant="link" className="h-auto p-0" onClick={onSelectAllFiltered}>
            Selecionar todos os {totalFilteredCount} filtrados
          </Button>
        </div>
      )}

      <BulkApplyTagDialog open={tagOpen} onOpenChange={setTagOpen} ctx={ctx} onDone={onAfterAction} />
      <BulkSetFieldDialog open={fieldOpen} onOpenChange={setFieldOpen} ctx={ctx} onDone={onAfterAction} />
      <BulkAddToPipelineDialog open={pipelineOpen} onOpenChange={setPipelineOpen} ctx={ctx} onDone={onAfterAction} />
      <BulkAutomationDialog open={automationOpen} onOpenChange={setAutomationOpen} ctx={ctx} onDone={onAfterAction} />
    </div>
  );
}
