import React from 'react';
import { X, Share2, PlusSquare, Smartphone, Laptop, CheckCircle2 } from 'lucide-react';

interface PwaInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  deferredPrompt?: any;
}

export const PwaInstallModal: React.FC<PwaInstallModalProps> = ({
  isOpen,
  onClose,
  deferredPrompt,
}) => {
  if (!isOpen) return null;

  const handleNativeInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        onClose();
      }
    }
  };

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-lg bg-white rounded-sm shadow-xl border border-[#E5E7EB] overflow-hidden my-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between bg-white">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-sm bg-[#2563EB] flex items-center justify-center text-white">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111827]">
                Install Johnfolio
              </h2>
              <p className="text-[11px] text-[#6B7280]">
                Fast, offline-ready web application on iOS &amp; macOS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#9CA3AF] hover:text-[#111827] hover:bg-gray-100 rounded-sm transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instructions Body */}
        <div className="p-6 space-y-5 text-xs text-[#6B7280] leading-relaxed">
          {deferredPrompt && (
            <div className="p-3 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB] text-center">
              <button
                onClick={handleNativeInstall}
                className="w-full py-2.5 px-4 bg-[#2563EB] hover:bg-blue-700 text-white font-medium rounded-sm shadow-xs transition-colors cursor-pointer"
              >
                Click to Install Johnfolio App
              </button>
            </div>
          )}

          {/* iOS Safari Instructions */}
          <div className="p-4 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB] space-y-3">
            <div className="flex items-center gap-2 font-semibold text-[#111827]">
              <Smartphone className="w-4 h-4 text-[#2563EB]" />
              <span>Apple Safari on iPhone &amp; iPad</span>
            </div>
            <ol className="space-y-2 list-decimal list-inside text-[#6B7280] pl-1">
              <li>
                Tap the <strong className="text-[#111827] font-medium">Share</strong> button <Share2 className="w-3.5 h-3.5 inline mx-0.5 text-[#111827]" /> in Safari's bottom toolbar.
              </li>
              <li>
                Scroll down and tap <strong className="text-[#111827] font-medium">Add to Home Screen</strong> <PlusSquare className="w-3.5 h-3.5 inline mx-0.5 text-[#111827]" />.
              </li>
              <li>
                Tap <strong className="text-[#111827] font-medium">Add</strong> in the top right. Johnfolio will launch full screen with native gestures.
              </li>
            </ol>
          </div>

          {/* macOS Safari / Chrome Instructions */}
          <div className="p-4 bg-[#F9FAFB] rounded-sm border border-[#E5E7EB] space-y-3">
            <div className="flex items-center gap-2 font-semibold text-[#111827]">
              <Laptop className="w-4 h-4 text-[#2563EB]" />
              <span>Apple Safari on macOS (Sonoma+)</span>
            </div>
            <p className="text-[#6B7280]">
              In Safari menu bar, click <strong className="text-[#111827] font-medium">File &gt; Add to Dock...</strong> to run Johnfolio as a standalone macOS desktop application.
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[#6B7280] pt-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
            <span>Standalone display mode, high-res Apple Touch Icon &amp; safe area layout active.</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#F9FAFB] border-t border-[#E5E7EB] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-[#E5E7EB] text-[#111827] font-medium rounded-sm hover:bg-gray-50 transition-colors text-xs cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
