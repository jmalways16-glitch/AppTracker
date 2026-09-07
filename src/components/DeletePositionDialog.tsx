import React, { useState } from 'react';
import { Position } from '../types';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface DeletePositionDialogProps {
  isOpen: boolean;
  position: Position | null;
  onClose: () => void;
  onConfirmDelete: (id: string) => Promise<void>;
}

export const DeletePositionDialog: React.FC<DeletePositionDialogProps> = ({
  isOpen,
  position,
  onClose,
  onConfirmDelete,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen || !position) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirmDelete(position.id);
      onClose();
    } catch (err) {
      console.error('Failed to delete position:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div 
        className="relative w-full max-w-md bg-white rounded-sm shadow-xl border border-[#E5E7EB] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3.5">
          <div className="w-9 h-9 rounded-sm bg-red-50 border border-red-200 flex items-center justify-center shrink-0 text-red-600 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[#111827]">
              Delete {position.symbol}?
            </h3>
            <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">
              Are you sure you want to delete <span className="font-semibold text-[#111827]">{position.quantity} shares</span> of{' '}
              <span className="font-semibold text-[#111827]">{position.symbol}</span> ({position.name})?
            </p>
            <p className="text-[11px] text-red-600 mt-2 font-medium">
              This action is permanent. The holding will be immediately removed from Firestore and all portfolio calculations.
            </p>
          </div>
        </div>

        <div className="pt-2 border-t border-[#F3F4F6] flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111827] hover:bg-gray-100 rounded-sm transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleConfirm}
            className="px-4 py-1.5 text-xs font-semibold bg-[#EF4444] text-white hover:bg-red-700 rounded-sm shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isDeleting && <RefreshCw className="w-3 h-3 animate-spin" />}
            <span>{isDeleting ? 'Deleting...' : 'Delete Position'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
