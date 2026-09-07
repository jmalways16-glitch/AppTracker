import React from 'react';
import { 
  LayoutDashboard, 
  Briefcase, 
  PieChart, 
  TrendingUp, 
  Newspaper, 
  UploadCloud, 
  RefreshCw, 
  Download 
} from 'lucide-react';

export type NavTab = 'dashboard' | 'holdings' | 'allocation' | 'benchmark' | 'news';

interface NavigationProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenImport: () => void;
  onRefreshMarketData: () => void;
  isRefreshing: boolean;
  lastRefreshTime?: string;
  onOpenPwaGuide: () => void;
  isCloudSynced: boolean;
  isCloudSaving?: boolean;
  cloudError?: string | null;
  positionsCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  onOpenImport,
  onRefreshMarketData,
  isRefreshing,
  lastRefreshTime,
  onOpenPwaGuide,
  isCloudSynced,
  isCloudSaving = false,
  cloudError = null,
  positionsCount,
}) => {
  const tabs: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { id: 'holdings', label: 'Holdings', icon: <Briefcase className="w-5 h-5" /> },
    { id: 'allocation', label: 'Allocation', icon: <PieChart className="w-5 h-5" /> },
    { id: 'benchmark', label: 'Benchmark', icon: <TrendingUp className="w-5 h-5" /> },
    { id: 'news', label: 'News', icon: <Newspaper className="w-5 h-5" /> },
  ];

  return (
    <>
      {/* 1) Minimal Top Bar with Safe Area Top for Dynamic Island / Standalone iOS PWA */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E5E7EB] pt-[env(safe-area-inset-top,0px)]">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            
            {/* Left: Johnfolio Brand + Subtle Firestore Status Dot */}
            <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
              <button 
                onClick={() => onSelectTab('dashboard')} 
                className="flex items-center space-x-2 group text-left cursor-pointer focus:outline-none min-h-[44px] py-1"
              >
                <div className="w-6 h-6 sm:w-7 sm:h-7 bg-[#2563EB] rounded-sm flex items-center justify-center text-white shadow-xs shrink-0">
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                    <polyline points="16 7 22 7 22 13" />
                  </svg>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2.5">
                  <span className="text-lg sm:text-xl font-bold tracking-tight uppercase text-[#111827]">
                    Johnfolio
                  </span>
                  
                  {/* Subtle Firestore Sync Dot: green = synced, amber = saving, red = error */}
                  <div className="flex items-center gap-1 text-[11px] font-medium pl-1.5 sm:pl-2.5 border-l border-[#E5E7EB]">
                    <span 
                      className={`w-2 h-2 rounded-full transition-colors shrink-0 ${
                        cloudError 
                          ? 'bg-[#EF4444]' 
                          : isCloudSaving 
                          ? 'bg-amber-400 animate-pulse' 
                          : isCloudSynced 
                          ? 'bg-[#10B981]' 
                          : 'bg-[#9CA3AF]'
                      }`} 
                    />
                    <span className={`hidden md:inline ${
                      cloudError 
                        ? 'text-[#EF4444]' 
                        : isCloudSaving 
                        ? 'text-amber-600' 
                        : isCloudSynced 
                        ? 'text-[#6B7280]' 
                        : 'text-[#9CA3AF]'
                    }`}>
                      {cloudError ? 'Sync Error' : isCloudSaving ? 'Saving...' : isCloudSynced ? 'Firestore' : 'Offline'}
                    </span>
                  </div>
                </div>
              </button>
            </div>

            {/* Right: Only the 3 Primary Global Action Buttons */}
            <div className="flex items-center space-x-1.5 sm:space-x-2.5 shrink-0">
              {/* 1. Install App */}
              <button
                onClick={onOpenPwaGuide}
                title="Install Johnfolio as PWA"
                className="inline-flex items-center space-x-1 p-1.5 sm:px-3 sm:py-1.5 text-xs font-medium text-[#4B5563] hover:text-[#111827] bg-white hover:bg-gray-50 border border-[#E5E7EB] rounded-sm transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#6B7280]" />
                <span className="hidden sm:inline">Install App</span>
              </button>

              {/* 2. Refresh Data */}
              <button
                onClick={onRefreshMarketData}
                disabled={isRefreshing || positionsCount === 0}
                title={lastRefreshTime ? `Last refreshed: ${lastRefreshTime}. Manual refresh only.` : 'Fetch latest market data from Finnhub, Yahoo & TwelveData'}
                className="inline-flex items-center space-x-1 p-1.5 sm:px-3 sm:py-1.5 text-xs font-medium text-[#111827] bg-white border border-[#E5E7EB] rounded-sm hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#6B7280] ${isRefreshing ? 'animate-spin text-[#2563EB]' : ''}`} />
                <span className="hidden sm:inline">{isRefreshing ? 'Updating...' : 'Refresh'}</span>
              </button>

              {/* 3. Import CSV */}
              <button
                onClick={onOpenImport}
                className="inline-flex items-center space-x-1 px-2.5 sm:px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-blue-700 active:bg-blue-800 rounded-sm transition-all shadow-xs cursor-pointer"
              >
                <UploadCloud className="w-3.5 h-3.5 text-blue-100" />
                <span>Import<span className="hidden xs:inline"> CSV</span></span>
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* 2) Fixed Modern Bottom Tab Bar (Mobile + Desktop) with Safe Area Bottom for iPhone Home Indicator */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/98 backdrop-blur-md border-t border-[#E5E7EB] shadow-[0_-4px_16px_rgba(0,0,0,0.04)] pb-[env(safe-area-inset-bottom,0px)]">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center justify-around h-16">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex flex-col items-center justify-center flex-1 min-h-[48px] py-1 transition-colors cursor-pointer relative ${
                    isActive 
                      ? 'text-[#2563EB]' 
                      : 'text-[#6B7280] hover:text-[#111827]'
                  }`}
                >
                  <div className="relative flex items-center justify-center">
                    {tab.icon}
                    {tab.id === 'holdings' && positionsCount > 0 && (
                      <span className="absolute -top-1 -right-2.5 min-w-[15px] h-[15px] flex items-center justify-center text-[9px] font-bold bg-[#2563EB] text-white rounded-full px-0.5 shadow-xs">
                        {positionsCount}
                      </span>
                    )}
                  </div>
                  <span className={`text-[11px] mt-1 tracking-tight ${isActive ? 'font-semibold text-[#2563EB]' : 'font-normal'}`}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
};
