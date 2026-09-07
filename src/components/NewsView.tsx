import React, { useState, useEffect } from 'react';
import { CompanyNewsArticle } from '../types';
import { getHeldSymbolsNews } from '../lib/marketApi';
import { Newspaper, ExternalLink, RefreshCw, Calendar, Globe } from 'lucide-react';

interface NewsViewProps {
  heldSymbols: string[];
}

export const NewsView: React.FC<NewsViewProps> = ({ heldSymbols }) => {
  const [articles, setArticles] = useState<CompanyNewsArticle[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (heldSymbols.length === 0) return;

    let isMounted = true;
    setLoading(true);

    getHeldSymbolsNews(heldSymbols)
      .then((data) => {
        if (isMounted) {
          setArticles(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.warn('Error fetching news:', e);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [heldSymbols]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6 pb-16">
      
      {/* Header */}
      <div>
        <h1 className="text-3xl font-light text-[#111827] mb-1 tracking-tight">
          Holdings News Feed
        </h1>
        <p className="text-sm text-[#6B7280]">
          Curated market announcements and updates strictly for assets in your portfolio
        </p>
      </div>

      {loading ? (
        <div className="py-16 text-center text-xs text-[#9CA3AF] flex flex-col items-center justify-center gap-3 bg-white border border-[#E5E7EB] rounded-sm p-8">
          <RefreshCw className="w-5 h-5 animate-spin text-[#2563EB]" />
          <span>Fetching recent news for {heldSymbols.length} held symbols...</span>
        </div>
      ) : articles.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.map((article) => (
            <a
              key={article.id}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-white border border-[#E5E7EB] rounded-sm p-5 hover:border-[#2563EB] hover:shadow-xs transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-[11px] mb-2 font-mono">
                  <span className="font-semibold text-[#2563EB] bg-blue-50 px-2 py-0.5 rounded-sm">
                    {article.symbol}
                  </span>
                  <span className="text-[#9CA3AF] flex items-center gap-1 font-sans">
                    {article.source} • {formatDate(article.datetime)}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-[#111827] group-hover:text-[#2563EB] leading-snug line-clamp-2">
                  {article.headline}
                </h3>

                {article.summary && (
                  <p className="text-xs text-[#6B7280] line-clamp-3 mt-2 leading-relaxed">
                    {article.summary}
                  </p>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-[#E5E7EB] flex items-center justify-between text-xs text-[#2563EB] font-medium">
                <span>Read article</span>
                <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-sm p-12 text-center text-xs text-[#9CA3AF]">
          {heldSymbols.length === 0
            ? 'No held symbols to monitor. Import your XTB file to load news.'
            : 'No news stories currently found for your held symbols.'}
        </div>
      )}

    </div>
  );
};
