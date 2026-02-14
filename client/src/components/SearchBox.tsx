import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, X, MapPin, History } from "lucide-react";
import type { StopsData } from "../types";
import {
  getSearchHistory,
  saveSearchHistory,
  removeFromSearchHistory,
} from "../utils";
import { fetchAllStops } from "../dataLoader";

interface SearchBoxProps {
  onSelectStop: (stopName: string, lat: number, lng: number) => void;
  onSearchStateChange: (isSearching: boolean) => void;
  onFocus?: () => void;
  isOpen?: boolean;
}

const SearchBox: React.FC<SearchBoxProps> = ({
  onSelectStop,
  onSearchStateChange,
  onFocus,
  isOpen = true,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchResults, setSearchResults] = useState<React.ReactNode[] | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [allStops, setAllStops] = useState<StopsData>({});

  // 初回マウント時に全バス停データを取得してキャッシュ
  useEffect(() => {
    const loadAllStops = async () => {
      try {
        const stops = await fetchAllStops();
        setAllStops(stops);
      } catch (e) {
        console.error("全バス停データの取得に失敗しました:", e);
      }
    };
    loadAllStops();
  }, []);

  const handleSelect = useCallback(
    (stopName: string, lat: number, lng: number, representativeId: string) => {
      saveSearchHistory(representativeId); // 履歴には代表IDを保存
      setShowSearchResults(false);
      onSearchStateChange(false);
      setSearchQuery("");
      // フォーカスを解除して仮想キーボードを閉じる
      if (inputRef.current) {
        inputRef.current.blur();
      }
      onSelectStop(stopName, lat, lng);
    },
    [onSearchStateChange, onSelectStop],
  );

  const showHistoryResults = useCallback(
    function showHistory() {
      if (onFocus) onFocus();

      const historyIds = getSearchHistory();
      if (historyIds.length === 0) {
        setShowSearchResults(false);
        onSearchStateChange(false);
        return;
      }

      onSearchStateChange(true);
      const items = [
        <div key="header" className="results-header">
          最近の検索
        </div>,
        ...historyIds
          .filter((id) => allStops[id])
          .map((id) => {
            const s = allStops[id];
            return (
              <div
                key={id}
                className="search-item"
                onClick={() => handleSelect(s.name, s.lat, s.lng, id)}
              >
                <History size={20} />
                <div className="search-item-info">
                  <div className="search-item-name">{s.name}</div>
                  <div className="search-item-yomi">{s.yomi}</div>
                </div>
                <span
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromSearchHistory(id);
                    showHistory();
                  }}
                >
                  <X size={18} />
                </span>
              </div>
            );
          }),
      ];
      setSearchResults(items);
      setShowSearchResults(true);
    },
    [allStops, onFocus, onSearchStateChange, handleSelect],
  );

  // カタカナをひらがなに変換
  const katakanaToHiragana = useCallback((str: string): string => {
    return str.replace(/[\u30A1-\u30F6]/g, (match) => {
      const chr = match.charCodeAt(0) - 0x60;
      return String.fromCharCode(chr);
    });
  }, []);

  // 漢字とひらがなの混在検索に対応した柔軟なマッチング関数
  const flexibleMatch = useCallback(
    (name: string, yomi: string, query: string): boolean => {
      let namePos = 0;
      let yomiPos = 0;

      for (const char of query) {
        const isKanji = /[\u4E00-\u9FAF\u3400-\u4DBF]/.test(char);
        const isKana = /[\u3040-\u309F\u30A0-\u30FF]/.test(char);

        if (isKanji) {
          // 漢字は名前から検索
          const pos = name.indexOf(char, namePos);
          if (pos === -1) return false;
          namePos = pos + 1;
        } else if (isKana) {
          // ひらがな・カタカナは読みから検索（カタカナはひらがなに正規化）
          const normalizedChar = katakanaToHiragana(char);
          const pos = yomi.indexOf(normalizedChar, yomiPos);
          if (pos === -1) return false;
          yomiPos = pos + 1;
        } else {
          // その他の文字（数字、記号など）は両方で検索
          const nameMatch = name.indexOf(char, namePos);
          const yomiMatch = yomi.indexOf(char, yomiPos);
          if (nameMatch === -1 && yomiMatch === -1) return false;
          if (nameMatch !== -1) namePos = nameMatch + 1;
          if (yomiMatch !== -1) yomiPos = yomiMatch + 1;
        }
      }

      return true;
    },
    [katakanaToHiragana],
  );

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (!query || query.trim().length === 0) {
        showHistoryResults();
        return;
      }

      const q = query.toLowerCase();

      // バス停名でグループ化
      const stopGroups: Record<
        string,
        { id: string; name: string; yomi: string; lat: number; lng: number }
      > = {};
      Object.keys(allStops).forEach((id) => {
        const s = allStops[id];
        if (!stopGroups[s.name]) {
          stopGroups[s.name] = {
            id,
            name: s.name,
            yomi: s.yomi,
            lat: s.lat,
            lng: s.lng,
          };
        }
      });

      // 柔軟なマッチングを使用
      const candidates = Object.values(stopGroups).filter((s) =>
        flexibleMatch(s.name.toLowerCase(), s.yomi.toLowerCase(), q),
      );

      // 先頭マッチの判定：クエリの最初の文字が名前またはよみの先頭から始まるか
      const tier1 = candidates.filter((s) => {
        const firstChar = q[0];
        const isKanji = /[\u4E00-\u9FAF\u3400-\u4DBF]/.test(firstChar);
        const isKana = /[\u3040-\u309F\u30A0-\u30FF]/.test(firstChar);

        if (isKanji) {
          return s.name.toLowerCase().startsWith(firstChar);
        } else if (isKana) {
          // カタカナはひらがなに正規化してから比較
          const normalizedFirstChar = katakanaToHiragana(firstChar);
          return s.yomi.toLowerCase().startsWith(normalizedFirstChar);
        } else {
          return (
            s.name.toLowerCase().startsWith(firstChar) ||
            s.yomi.toLowerCase().startsWith(firstChar)
          );
        }
      });
      const tier2 = candidates.filter((s) => !tier1.includes(s));

      const sortByLength = (a: { name: string }, b: { name: string }) =>
        a.name.length - b.name.length;
      tier1.sort(sortByLength);
      tier2.sort(sortByLength);

      const results = [...tier1, ...tier2].slice(0, 5);

      if (results.length > 0) {
        onSearchStateChange(true);
        const items = [
          <div key="header" className="results-header">
            検索結果
          </div>,
          ...results.map((s) => (
            <div
              key={s.id}
              className="search-item"
              onClick={() => handleSelect(s.name, s.lat, s.lng, s.id)}
            >
              <MapPin size={20} />
              <div className="search-item-info">
                <div className="search-item-name">{s.name}</div>
                <div className="search-item-yomi">{s.yomi}</div>
              </div>
            </div>
          )),
        ];
        setSearchResults(items);
        setShowSearchResults(true);
        onSearchStateChange(true);
      } else {
        onSearchStateChange(false);
        setShowSearchResults(false);
      }
    },
    [
      allStops,
      onSearchStateChange,
      showHistoryResults,
      handleSelect,
      flexibleMatch,
      katakanaToHiragana,
    ],
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setShowSearchResults(false);
    onSearchStateChange(false);
  }, [onSearchStateChange]);

  // 外部から isOpen = false で閉じられたら、検索結果を非表示にする
  useEffect(() => {
    if (!isOpen) {
      setShowSearchResults(false);
    }
  }, [isOpen]);

  // 外クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#search-container")) {
        setShowSearchResults(false);
        onSearchStateChange(false);
        // フォーカスを解除して仮想キーボードを閉じる
        if (inputRef.current) {
          inputRef.current.blur();
        }
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onSearchStateChange]);

  return (
    <div id="search-container">
      <div className="search-box">
        <Search size={20} />
        <input
          ref={inputRef}
          type="text"
          placeholder="バス停を検索"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={showHistoryResults}
          onClick={showHistoryResults}
        />
        {searchQuery && (
          <span className="search-clear-btn" onClick={clearSearch}>
            <X size={20} />
          </span>
        )}
      </div>
      {showSearchResults && searchResults && (
        <div id="search-results">{searchResults}</div>
      )}
    </div>
  );
};

export default SearchBox;
