import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  CloseButton,
  Description,
  Header,
  Label,
  ListBox,
  SearchField,
  Surface,
} from "@heroui/react";
import type { StopsData } from "../types";
import {
  getSearchHistory,
  saveSearchHistory,
  removeFromSearchHistory,
} from "../utils";
import { fetchAllStops } from "../dataLoader";

interface SearchBoxProps {
  allStops?: StopsData;
  onSelectStop: (stopName: string, lat: number, lng: number) => void;
  onSearchStateChange: (isSearching: boolean) => void;
  onFocus?: () => void;
  isOpen?: boolean;
}

interface StopCandidate {
  id: string;
  name: string;
  yomi: string;
  lat: number;
  lng: number;
}

const SearchBox: React.FC<SearchBoxProps> = ({
  allStops: externalStops,
  onSelectStop,
  onSearchStateChange,
  onFocus,
  isOpen = true,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isClearingRef = useRef(false);
  const [fetchedStops, setFetchedStops] = useState<StopsData>({});
  const allStops = externalStops ?? fetchedStops;

  // 外部から渡されていない場合のみ初回マウント時に全バス停データを取得
  useEffect(() => {
    if (externalStops) return;
    const loadAllStops = async () => {
      try {
        const stops = await fetchAllStops();
        setFetchedStops(stops);
      } catch (e) {
        console.error("全バス停データの取得に失敗しました:", e);
      }
    };
    loadAllStops();
  }, [externalStops]);

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
          const pos = name.indexOf(char, namePos);
          if (pos === -1) return false;
          namePos = pos + 1;
        } else if (isKana) {
          const normalizedChar = katakanaToHiragana(char);
          const pos = yomi.indexOf(normalizedChar, yomiPos);
          if (pos === -1) return false;
          yomiPos = pos + 1;
        } else {
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

  // バス停名でグループ化
  const stopGroups = useMemo<StopCandidate[]>(() => {
    const groups: Record<string, StopCandidate> = {};
    Object.keys(allStops).forEach((id) => {
      const s = allStops[id];
      if (!groups[s.name]) {
        groups[s.name] = {
          id,
          name: s.name,
          yomi: s.yomi,
          lat: s.lat,
          lng: s.lng,
        };
      }
    });
    return Object.values(groups);
  }, [allStops]);

  const historyItems = useMemo<StopCandidate[]>(() => {
    void historyTick;
    return getSearchHistory()
      .filter((id) => allStops[id])
      .map((id) => {
        const s = allStops[id];
        return { id, name: s.name, yomi: s.yomi, lat: s.lat, lng: s.lng };
      });
  }, [allStops, historyTick]);

  const searchResultsList = useMemo<StopCandidate[]>(() => {
    if (!searchQuery || searchQuery.trim().length === 0) return [];
    const q = searchQuery.toLowerCase();

    const candidates = stopGroups.filter((s) =>
      flexibleMatch(s.name.toLowerCase(), s.yomi.toLowerCase(), q),
    );

    const tier1 = candidates.filter((s) => {
      const firstChar = q[0];
      const isKanji = /[\u4E00-\u9FAF\u3400-\u4DBF]/.test(firstChar);
      const isKana = /[\u3040-\u309F\u30A0-\u30FF]/.test(firstChar);

      if (isKanji) {
        return s.name.toLowerCase().startsWith(firstChar);
      } else if (isKana) {
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

    return [...tier1, ...tier2].slice(0, 5);
  }, [searchQuery, stopGroups, flexibleMatch, katakanaToHiragana]);

  const isHistoryMode = searchQuery.trim().length === 0;
  const activeItems = isHistoryMode ? historyItems : searchResultsList;

  const handleSelect = useCallback(
    (stopName: string, lat: number, lng: number, representativeId: string) => {
      saveSearchHistory(representativeId);
      setHistoryTick((t) => t + 1);
      setShowSearchResults(false);
      onSearchStateChange(false);
      setSearchQuery("");
      inputRef.current?.blur();
      onSelectStop(stopName, lat, lng);
    },
    [onSearchStateChange, onSelectStop],
  );

  const showHistoryResults = useCallback(() => {
    if (onFocus) onFocus();

    if (historyItems.length === 0) {
      setShowSearchResults(false);
      onSearchStateChange(false);
      return;
    }

    onSearchStateChange(true);
    setShowSearchResults(true);
  }, [historyItems.length, onFocus, onSearchStateChange]);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (isClearingRef.current) {
        isClearingRef.current = false;
        return;
      }
      if (!query || query.trim().length === 0) {
        showHistoryResults();
        return;
      }

      const q = query.toLowerCase();
      const hasMatch = stopGroups.some((s) =>
        flexibleMatch(s.name.toLowerCase(), s.yomi.toLowerCase(), q),
      );
      setShowSearchResults(hasMatch);
      onSearchStateChange(hasMatch);
    },
    [stopGroups, flexibleMatch, onSearchStateChange, showHistoryResults],
  );

  const clearSearch = useCallback(() => {
    isClearingRef.current = true;
    setSearchQuery("");
    setShowSearchResults(false);
    onSearchStateChange(false);
  }, [onSearchStateChange]);

  // 外クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowSearchResults(false);
        onSearchStateChange(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [onSearchStateChange]);

  const handleDeleteHistory = useCallback(
    (id: string) => {
      removeFromSearchHistory(id);
      const remaining = getSearchHistory().filter((itemId) => allStops[itemId]);
      setHistoryTick((t) => t + 1);
      if (remaining.length === 0) {
        setShowSearchResults(false);
        onSearchStateChange(false);
      }
    },
    [allStops, onSearchStateChange],
  );

  return (
    <div
      id="search-container"
      ref={containerRef}
      className="pointer-events-none absolute top-5 left-5 z-[7000] flex w-[calc(100%-40px)] max-w-[360px] flex-col gap-2 max-md:top-2.5 max-md:left-2.5 max-md:w-[calc(100%-20px)] max-md:max-w-none"
    >
      <SearchField
        fullWidth
        aria-label="バス停を検索"
        value={searchQuery}
        onChange={handleSearch}
        onClear={clearSearch}
        className="pointer-events-auto"
      >
        <SearchField.Group className="glass-surface h-12 rounded-full px-1.5">
          <SearchField.SearchIcon className="ms-3 size-4.5 text-muted" />
          <SearchField.Input
            ref={inputRef}
            placeholder="バス停を検索"
            onFocus={showHistoryResults}
            onClick={showHistoryResults}
          />
          <SearchField.ClearButton aria-label="検索をクリア" />
        </SearchField.Group>
      </SearchField>

      {isOpen && showSearchResults && activeItems.length > 0 && (
        <Surface
          id="search-results"
          variant="default"
          className="glass-surface-lg pointer-events-auto max-h-[400px] overflow-y-auto rounded-2xl p-1.5"
        >
          {isHistoryMode ? (
            <div role="region" aria-label="最近の検索">
              <Header>最近の検索</Header>
              <div className="flex flex-col gap-1">
                {historyItems.map((s) => (
                  <div
                    key={s.id}
                    className="flex min-h-9 w-full items-center gap-1 rounded-2xl px-2 py-1.5 transition-colors hover:bg-default"
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(s.name, s.lat, s.lng, s.id)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 bg-transparent text-left outline-none"
                    >
                      <span
                        className="material-icons-outlined shrink-0 text-[18px] text-muted"
                        aria-hidden
                      >
                        history
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-bold text-foreground">
                          {s.name}
                        </span>
                        {s.yomi && (
                          <span className="truncate text-[11px] text-muted">
                            {s.yomi}
                          </span>
                        )}
                      </div>
                    </button>
                    <CloseButton
                      aria-label={`${s.name}を履歴から削除`}
                      onPress={() => handleDeleteHistory(s.id)}
                      className="shrink-0"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <ListBox
              aria-label="検索結果"
              onAction={(key) => {
                const selected = searchResultsList.find(
                  (item) => item.id === String(key),
                );
                if (selected) {
                  handleSelect(
                    selected.name,
                    selected.lat,
                    selected.lng,
                    selected.id,
                  );
                }
              }}
            >
              <ListBox.Section>
                <Header>検索結果</Header>
                {searchResultsList.map((s) => (
                  <ListBox.Item key={s.id} id={s.id} textValue={s.name}>
                    <span
                      className="material-icons-outlined shrink-0 text-[18px] text-muted"
                      aria-hidden
                    >
                      place
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <Label className="text-sm font-bold text-foreground">
                        {s.name}
                      </Label>
                      {s.yomi && (
                        <Description className="text-[11px] text-muted">
                          {s.yomi}
                        </Description>
                      )}
                    </div>
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            </ListBox>
          )}
        </Surface>
      )}
    </div>
  );
};

export default SearchBox;
