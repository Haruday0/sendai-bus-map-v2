import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot } from "react-dom/client";
import { BusFront } from "lucide-react";
import type { AppData, PanelTrip, BusPosition } from "../types";
import { fetchBusPositions } from "../dataLoader";
import { formatHeadsign } from "../utils";

interface MapContainerProps {
  data: AppData;
  activeLayer: "pale" | "ortho";
  selectedTrip: PanelTrip | null;
  onStopClick: (id: string, zoom?: number) => void;
  onBusClick: (tripId: string, routeId: string, highlightId?: string) => void;
  onMapClick: () => void;
  onMoveStart: () => void;
  onZoomChange: (zoom: number) => void;
  updateBuses?: () => void; // 内部用だが型定義上必要なら
  setMapRef: (map: maplibregl.Map | null) => void;
  onBoundsChange?: (
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
  ) => void;
}

/** lucide-react の BusFront アイコンを含む DOM 要素を生成 */
function createBusMarkerElement(
  routeName: string,
  headsign: string,
  onClick: () => void,
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "bus-marker-container";

  const label = document.createElement("div");
  label.className = "bus-label";
  label.textContent = `[${routeName}] ${formatHeadsign(headsign)}`;
  container.appendChild(label);

  const iconWrapper = document.createElement("div");
  iconWrapper.className = "bus-icon-wrapper";
  container.appendChild(iconWrapper);
  const root = createRoot(iconWrapper);
  root.render(<BusFront size={34} strokeWidth={2} />);

  container.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });

  return container;
}

const MapContainer: React.FC<MapContainerProps> = ({
  data,
  activeLayer,
  selectedTrip,
  onStopClick,
  onBusClick,
  onMapClick,
  onMoveStart,
  onZoomChange,
  setMapRef,
  onBoundsChange,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const busMarkersRef = useRef<Record<string, maplibregl.Marker>>({});

  // 地図の準備完了状態を管理
  const isStyleLoadedRef = useRef(false);
  const [, forceUpdate] = useState({});

  // 外部参照用の ref 同期
  useEffect(() => {
    setMapRef(mapRef.current);
  }, [setMapRef]);

  // --- バス停マーカー更新 ---
  const updateStopMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoadedRef.current) return;

    stopMarkersRef.current.forEach((m) => m.remove());
    stopMarkersRef.current = [];

    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const activeTripStops = selectedTrip
      ? data.timetables[selectedTrip.routeId]?.[selectedTrip.tripId]?.stops.map(
          (s) => s.stop_id,
        ) || []
      : [];
    const seen = new Set<string>();

    Object.keys(data.stops).forEach((id) => {
      const stop = data.stops[id];
      const isSelectedRouteStop = activeTripStops.includes(id);

      if (selectedTrip && !isSelectedRouteStop) return;
      if (!bounds.contains([stop.lng, stop.lat]) && !isSelectedRouteStop)
        return;
      if (zoom < 13.5 && !isSelectedRouteStop) return;

      if (zoom < 16.5) {
        if (seen.has(stop.name)) return;
        seen.add(stop.name);
      }

      const el = document.createElement("div");
      el.className = "stop-marker-container";

      if (zoom >= 13.5 || isSelectedRouteStop) {
        const label = document.createElement("div");
        label.className = "stop-label";
        label.innerText =
          stop.name +
          (zoom >= 16.5 && stop.platform ? ` (${stop.platform}番)` : "");
        el.appendChild(label);
      }

      const dot = document.createElement("div");
      dot.className = "stop-dot";
      el.appendChild(dot);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([stop.lng, stop.lat])
        .addTo(map);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onStopClick(id, map.getZoom());
      });

      stopMarkersRef.current.push(marker);
    });
  }, [data, selectedTrip, onStopClick]);

  // --- バスマーカー更新 ---
  const updateBuses = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !isStyleLoadedRef.current) return;

    try {
      // 地図の表示範囲を取得
      const bounds = map.getBounds();
      const minLat = bounds.getSouth();
      const maxLat = bounds.getNorth();
      const minLng = bounds.getWest();
      const maxLng = bounds.getEast();

      // サーバーから範囲内のバス位置を取得
      const buses = await fetchBusPositions(minLat, maxLat, minLng, maxLng);
      // デバッグ: 取得範囲と件数をログ出力
      try {
        console.debug(
          "fetchBusPositions bounds:",
          { minLat, maxLat, minLng, maxLng },
          "count:",
          buses?.length,
        );
      } catch {
        // noop
      }
      const zoom = map.getZoom();
      const isCompact = zoom < 15.0;

      // 現在のマーカーIDセット
      const activeTripIds = new Set<string>();

      // 取得したバスをマーカーとして配置
      buses.forEach((bus: BusPosition) => {
        const tripId = bus.trip_id;

        // selectedTripがある場合、そのtripIdのみ表示
        if (selectedTrip && tripId !== selectedTrip.tripId) {
          // 選択されていないバスのマーカーを削除
          if (busMarkersRef.current[tripId]) {
            busMarkersRef.current[tripId].remove();
            delete busMarkersRef.current[tripId];
          }
          return;
        }

        activeTripIds.add(tripId);

        if (!busMarkersRef.current[tripId]) {
          const el = createBusMarkerElement(
            bus.route_name,
            bus.headsign,
            () => {
              onBusClick(tripId, bus.route_id);
            },
          );

          busMarkersRef.current[tripId] = new maplibregl.Marker({
            element: el,
          })
            .setLngLat(bus.position as [number, number])
            .addTo(map);
        } else {
          busMarkersRef.current[tripId].setLngLat(
            bus.position as [number, number],
          );
        }

        const markerEl = busMarkersRef.current[tripId].getElement();
        if (isCompact) markerEl.classList.add("compact");
        else markerEl.classList.remove("compact");
      });

      // 運行終了したバスのマーカーを削除（selectedTripがない場合のみ）
      if (!selectedTrip) {
        Object.keys(busMarkersRef.current).forEach((tripId) => {
          if (!activeTripIds.has(tripId)) {
            busMarkersRef.current[tripId].remove();
            delete busMarkersRef.current[tripId];
          }
        });
      }
    } catch (error) {
      console.error("Failed to fetch bus positions:", error);
    }
  }, [selectedTrip, onBusClick]);

  // --- ルートライン描画 ---
  const drawRouteLine = useCallback(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoadedRef.current) return;

    if (map.getLayer("route-arrows")) map.removeLayer("route-arrows");
    if (map.getLayer("route-line")) map.removeLayer("route-line");
    if (map.getSource("route")) map.removeSource("route");

    if (!selectedTrip) return;

    const trip = data.timetables[selectedTrip.routeId]?.[selectedTrip.tripId];
    if (!trip) return;

    const patternKey = trip.stops.map((s) => s.stop_id).join("|");
    const shape = data.shapes[patternKey];
    if (!shape) return;

    const routeInfo = data.routes[selectedTrip.routeId];

    map.addSource("route", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: shape.coordinates },
      },
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      paint: {
        "line-color": "#" + (routeInfo?.color || "00703c"),
        "line-width": 8,
        "line-opacity": 0.6,
      },
    });
    map.addLayer({
      id: "route-arrows",
      type: "symbol",
      source: "route",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 80,
        "icon-image": "arrow",
        "icon-size": 0.5,
        "icon-rotate": 270,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }, [data, selectedTrip]);

  // ハンドラの最新版を参照する Ref（map 初期化時に安全に呼び出すため）
  const updateStopMarkersRef = useRef(updateStopMarkers);
  const updateBusesRef = useRef(updateBuses);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onMapClickRef = useRef(onMapClick);
  const onMoveStartRef = useRef(onMoveStart);
  const onZoomChangeRef = useRef(onZoomChange);

  // ハンドラ refs を常に最新に
  useEffect(() => {
    updateStopMarkersRef.current = updateStopMarkers;
  }, [updateStopMarkers]);
  useEffect(() => {
    updateBusesRef.current = updateBuses;
  }, [updateBuses]);
  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);
  useEffect(() => {
    onMoveStartRef.current = onMoveStart;
  }, [onMoveStart]);
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  // イベントリスナは map 初期化時に登録し、必要に応じてこの useEffect で再登録する
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const moveendHandler = () => {
      updateStopMarkers();
      updateBuses();
      onZoomChange(map.getZoom());
      try {
        const b = map.getBounds();
        if (b && typeof onBoundsChange === "function") {
          onBoundsChange(b.getSouth(), b.getNorth(), b.getWest(), b.getEast());
        }
      } catch {
        // noop
      }
    };

    const movestartHandler = () => onMoveStart();

    const clickHandler = (e: maplibregl.MapMouseEvent) => {
      const el = (e.originalEvent.target as HTMLElement) || null;
      if (el && el.className && el.className.includes("maplibregl-canvas")) {
        onMapClick();
      }
    };

    map.on("moveend", moveendHandler);
    map.on("movestart", movestartHandler);
    map.on("click", clickHandler);

    return () => {
      map.off("moveend", moveendHandler);
      map.off("movestart", movestartHandler);
      map.off("click", clickHandler);
    };
  }, [
    onMapClick,
    onMoveStart,
    updateBuses,
    updateStopMarkers,
    onZoomChange,
    onBoundsChange,
  ]);

  // マップ初期化
  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainerRef.current!,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          gsi: {
            type: "raster",
            tiles: [
              "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution:
              '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院地図</a>',
            maxzoom: 18,
          },
          "gsi-ortho": {
            type: "raster",
            tiles: ["https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg"],
            tileSize: 256,
            attribution:
              '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院地図</a>',
            maxzoom: 18,
          },
        },
        layers: [
          { id: "gsi-layer", type: "raster", source: "gsi" },
          {
            id: "gsi-ortho-layer",
            type: "raster",
            source: "gsi-ortho",
            layout: { visibility: "none" },
          },
        ],
      },
      center: [140.8824, 38.2601],
      zoom: 15,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on("load", () => {
      isStyleLoadedRef.current = true;
      forceUpdate({});

      // 矢印アイコン生成
      const width = 16,
        height = 16;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.beginPath();
      ctx.moveTo(2, 4);
      ctx.lineTo(width / 2, height - 4);
      ctx.lineTo(width - 2, 4);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      const imageData = ctx.getImageData(0, 0, width, height);
      map.addImage("arrow", imageData);

      // 初期ロード時は最新の refs 経由で呼び出す
      try {
        updateStopMarkersRef.current();
      } catch {
        // noop
      }
      try {
        updateBusesRef.current();
      } catch {
        // noop
      }
      // 初期ロード時に現在の bounds を親に通知して stops を取得させる
      try {
        const b = map.getBounds();
        if (b && typeof onBoundsChangeRef.current === "function") {
          onBoundsChangeRef.current(
            b.getSouth(),
            b.getNorth(),
            b.getWest(),
            b.getEast(),
          );
        }
      } catch {
        // noop
      }
    });

    // バス更新の定期実行は refs 経由で行う（ハンドラが変わっても参照は最新）
    const busInterval = setInterval(() => {
      try {
        updateBusesRef.current();
      } catch {
        // noop
      }
    }, 5000);

    return () => {
      clearInterval(busInterval);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // レイヤー切り替え同期
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoadedRef.current) return;
    if (activeLayer === "pale") {
      map.setLayoutProperty("gsi-layer", "visibility", "visible");
      map.setLayoutProperty("gsi-ortho-layer", "visibility", "none");
    } else {
      map.setLayoutProperty("gsi-layer", "visibility", "none");
      map.setLayoutProperty("gsi-ortho-layer", "visibility", "visible");
    }
  }, [activeLayer]);

  // 便選択時の描画・マーカー更新同期
  useEffect(() => {
    if (!isStyleLoadedRef.current) return;
    drawRouteLine();
    updateStopMarkers();
    updateBuses();
  }, [drawRouteLine, updateStopMarkers, updateBuses]);

  return <div id="map" ref={mapContainerRef}></div>;
};

export default MapContainer;
