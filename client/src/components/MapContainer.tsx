import React, { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot, type Root } from "react-dom/client";
// using Material Icons font for markers
import type { AppData, PanelTrip, BusPosition } from "../types";
import { fetchBusPositions } from "../dataLoader";
import { formatHeadsign } from "../utils";

function createGeoJSONCircle(
  center: [number, number],
  radiusInMeters: number,
  points = 64,
) {
  const [lng, lat] = center;
  const coords: [number, number][] = [];
  const km = radiusInMeters / 1000;
  const distanceX = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const distanceY = km / 110.574;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coords.push([lng + x, lat + y]);
  }
  coords.push(coords[0]);

  return {
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [coords],
    },
    properties: {},
  };
}

const busMarkerRoots = new WeakMap<HTMLElement, Root>();

function disposeBusMarker(marker: maplibregl.Marker): void {
  const element = marker.getElement();
  busMarkerRoots.get(element)?.unmount();
  busMarkerRoots.delete(element);
  marker.remove();
}

interface MapContainerProps {
  data: AppData;
  activeLayer: "pale" | "ortho" | "osm";
  isPanelOpen?: boolean;
  selectedTrip: PanelTrip | null;
  simTime?: string;
  onStopClick: (id: string, zoom?: number) => void;
  onBusClick: (
    tripId: string,
    routeId: string,
    highlightId?: string,
    speedKmh?: number,
    occupancyStatus?: string,
  ) => void;
  onMapClick: () => void;
  onMoveStart: () => void;
  onZoomChange: (zoom: number) => void;
  updateBuses?: () => void;
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

  const formattedHeadsign = formatHeadsign(headsign);

  // ラベル全体のラッパー
  const label = document.createElement("div");
  label.className = "bus-label";

  // 系統番号バッジ
  const badge = document.createElement("span");
  badge.className = "bus-label-badge";
  badge.textContent = routeName;
  label.appendChild(badge);

  // 行先テキスト（バッジがあるときのみ表示）
  if (formattedHeadsign) {
    const dest = document.createElement("span");
    dest.className = "bus-label-dest";
    dest.textContent = formattedHeadsign;
    label.appendChild(dest);
  }

  container.appendChild(label);

  const iconWrapper = document.createElement("div");
  iconWrapper.className = "bus-icon-wrapper";
  container.appendChild(iconWrapper);
  const root = createRoot(iconWrapper);
  busMarkerRoots.set(container, root);
  root.render(
    <span className="material-icons-outlined bus-marker-icon" aria-hidden>
      directions_bus
    </span>,
  );

  container.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });

  return container;
}

const MapContainer: React.FC<MapContainerProps> = ({
  data,
  activeLayer,
  isPanelOpen = false,
  selectedTrip,
  simTime,
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
  const busRequestIdRef = useRef(0);
  const compactDisplayRef = useRef<boolean | null>(null);

  // 現在地マーカーと連打防止用フラグ
  const currentLocationMarkerRef = useRef<maplibregl.Marker | null>(null);
  const isLocatingRef = useRef(false);

  // 地図の準備完了状態を管理
  const isStyleLoadedRef = useRef(false);
  const [, forceUpdate] = useState({});

  // バス更新コスト削減用：更新停止フラグ、最後のアクティビティ時刻、不活動タイマー
  const [isUpdatesPaused, setIsUpdatesPaused] = useState(false);
  const lastActivityTimeRef = useRef<number>(0);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLayerRef = useRef<"pale" | "ortho" | "osm">(activeLayer);

  const isPanelOpenRef = useRef(isPanelOpen);
  useEffect(() => {
    isPanelOpenRef.current = isPanelOpen;
  }, [isPanelOpen]);

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

        const isMobile = window.innerWidth < 768;
        map.flyTo({
          center: [stop.lng, stop.lat],
          zoom: map.getZoom(),
          speed: 1.2,
          padding: isMobile
            ? { top: 0, bottom: window.innerHeight * 0.55, left: 0, right: 0 }
            : { top: 0, bottom: 0, left: 400, right: 0 },
        });
      });

      stopMarkersRef.current.push(marker);
    });
  }, [data, selectedTrip, onStopClick]);

  // --- バスマーカー更新 ---
  const updateBuses = useCallback(async () => {
    if (isUpdatesPaused) {
      return;
    }

    const map = mapRef.current;
    if (!map || !isStyleLoadedRef.current) return;
    const requestId = ++busRequestIdRef.current;

    try {
      const bounds = map.getBounds();
      const minLat = bounds.getSouth();
      const maxLat = bounds.getNorth();
      const minLng = bounds.getWest();
      const maxLng = bounds.getEast();

      const buses = await fetchBusPositions(
        minLat,
        maxLat,
        minLng,
        maxLng,
        simTime,
      );
      if (requestId !== busRequestIdRef.current) return;

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

      const activeTripIds = new Set<string>();

      buses.forEach((bus: BusPosition) => {
        const tripId = bus.trip_id;

        if (selectedTrip && tripId !== selectedTrip.tripId) {
          if (busMarkersRef.current[tripId]) {
            disposeBusMarker(busMarkersRef.current[tripId]);
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
              onBusClick(
                tripId,
                bus.route_id,
                undefined,
                bus.speed_kmh,
                bus.occupancy_status,
              );

              const isMobile = window.innerWidth < 768;
              map.flyTo({
                center: bus.position as [number, number],
                zoom: map.getZoom(),
                speed: 1.2,
                padding: isMobile
                  ? {
                      top: 0,
                      bottom: window.innerHeight * 0.55,
                      left: 0,
                      right: 0,
                    }
                  : { top: 0, bottom: 0, left: 400, right: 0 },
              });
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

      if (!selectedTrip) {
        Object.keys(busMarkersRef.current).forEach((tripId) => {
          if (!activeTripIds.has(tripId)) {
            disposeBusMarker(busMarkersRef.current[tripId]);
            delete busMarkersRef.current[tripId];
          }
        });
      }
    } catch (error) {
      console.error("Failed to fetch bus positions:", error);
    }
  }, [selectedTrip, onBusClick, isUpdatesPaused, simTime]);

  const updateBusMarkerDisplay = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const isCompact = map.getZoom() < 15.0;
    if (compactDisplayRef.current === isCompact) return;
    compactDisplayRef.current = isCompact;
    map.getContainer().classList.toggle("compact-bus-labels", isCompact);
  }, []);

  const updateZoomDependentDisplay = useCallback(() => {
    updateBusMarkerDisplay();
    updateStopMarkers();
  }, [updateBusMarkerDisplay, updateStopMarkers]);

  // --- ユーザーの現在地を取得して移動 ---
  const handleLocateUser = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!navigator.geolocation) {
      alert("お使いのブラウザは位置情報機能に対応していません。");
      return;
    }

    if (isLocatingRef.current) return;
    isLocatingRef.current = true;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        isLocatingRef.current = false;
        // 💡 accuracy（GPSの誤差メートル）も一緒に受け取る
        const { longitude, latitude, accuracy } = position.coords;

        // 1. 地図の縮尺に合わせて伸び縮みする誤差円を描く
        const accuracyGeoJSON = createGeoJSONCircle(
          [longitude, latitude],
          accuracy || 20,
        );
        const accuracySource = map.getSource(
          "user-location-accuracy",
        ) as maplibregl.GeoJSONSource;

        if (accuracySource) {
          accuracySource.setData(accuracyGeoJSON);
        } else {
          map.addSource("user-location-accuracy", {
            type: "geojson",
            data: accuracyGeoJSON,
          });
          map.addLayer({
            id: "user-location-accuracy-fill",
            type: "fill",
            source: "user-location-accuracy",
            paint: {
              "fill-color": "#2563eb",
              "fill-opacity": 0.15,
            },
          });
          map.addLayer({
            id: "user-location-accuracy-line",
            type: "line",
            source: "user-location-accuracy",
            paint: {
              "line-color": "#2563eb",
              "line-width": 1,
              "line-opacity": 0.3,
            },
          });
        }

        // 2. 中心の青丸マーカーを配置
        if (currentLocationMarkerRef.current) {
          currentLocationMarkerRef.current.setLngLat([longitude, latitude]);
        } else {
          const markerEl = document.createElement("div");
          markerEl.className = "user-location-marker";
          markerEl.innerHTML = `<div class="user-location-dot"></div>`;

          currentLocationMarkerRef.current = new maplibregl.Marker({
            element: markerEl,
          })
            .setLngLat([longitude, latitude])
            .addTo(map);
        }

        const targetZoom = Math.max(map.getZoom(), 16);
        const isMobile = window.innerWidth < 768;

        map.flyTo({
          center: [longitude, latitude],
          zoom: targetZoom,
          speed: 1.2,
          essential: true,
          padding:
            isPanelOpenRef.current && isMobile
              ? { top: 0, bottom: window.innerHeight * 0.55, left: 0, right: 0 }
              : { top: 0, bottom: 0, left: 0, right: 0 },
        });
      },
      (error) => {
        isLocatingRef.current = false;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            alert(
              "位置情報の利用が許可されていません。\nブラウザの設定から位置情報の権限を許可してください。",
            );
            break;
          case error.POSITION_UNAVAILABLE:
            alert("位置情報を取得できませんでした。電波状況をご確認ください。");
            break;
          case error.TIMEOUT:
            alert(
              "位置情報の取得がタイムアウトしました。もう一度お試しください。",
            );
            break;
          default:
            alert("位置情報の取得中にエラーが発生しました。");
            break;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  }, []);

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

  const drawRouteLineRef = useRef(drawRouteLine);
  const updateStopMarkersRef = useRef(updateStopMarkers);
  const updateBusesRef = useRef(updateBuses);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onMapClickRef = useRef(onMapClick);
  const onMoveStartRef = useRef(onMoveStart);
  const onZoomChangeRef = useRef(onZoomChange);

  const applyLayerVisibility = useCallback(
    (map: maplibregl.Map, layer: "pale" | "ortho" | "osm") => {
      map.setLayoutProperty(
        "gsi-layer",
        "visibility",
        layer === "pale" ? "visible" : "none",
      );
      map.setLayoutProperty(
        "gsi-ortho-layer",
        "visibility",
        layer === "ortho" ? "visible" : "none",
      );
      map.setLayoutProperty(
        "osm-layer",
        "visibility",
        layer === "osm" ? "visible" : "none",
      );
    },
    [],
  );

  useEffect(() => {
    drawRouteLineRef.current = drawRouteLine;
  }, [drawRouteLine]);
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const moveendHandler = () => {
      map.getContainer().classList.remove("is-zooming");
      onZoomChange(map.getZoom());
      updateZoomDependentDisplay();

      if (isPanelOpenRef.current) {
        return;
      }

      updateBuses();
      try {
        const b = map.getBounds();
        if (b && typeof onBoundsChange === "function") {
          onBoundsChange(b.getSouth(), b.getNorth(), b.getWest(), b.getEast());
        }
      } catch {
        // noop
      }
    };

    const movestartHandler = () => {
      map.getContainer().classList.add("is-zooming");
      onMoveStart();
    };

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
    updateBusMarkerDisplay,
    updateZoomDependentDisplay,
    onZoomChange,
    onBoundsChange,
  ]);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainerRef.current!,
      attributionControl: false,
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
              '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>',
            maxzoom: 18,
          },
          "gsi-ortho": {
            type: "raster",
            tiles: ["https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg"],
            tileSize: 256,
            attribution:
              '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>',
            maxzoom: 18,
          },
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
            maxzoom: 19,
          },
        },
        layers: [
          {
            id: "gsi-layer",
            type: "raster",
            source: "gsi",
            layout: {
              visibility:
                initialLayerRef.current === "pale" ? "visible" : "none",
            },
          },
          {
            id: "gsi-ortho-layer",
            type: "raster",
            source: "gsi-ortho",
            layout: {
              visibility:
                initialLayerRef.current === "ortho" ? "visible" : "none",
            },
          },
          {
            id: "osm-layer",
            type: "raster",
            source: "osm",
            layout: {
              visibility:
                initialLayerRef.current === "osm" ? "visible" : "none",
            },
          },
        ],
      },
      center: [140.8824, 38.2601],
      zoom: 15,
    });

    mapRef.current = map;

    map.on("load", () => {
      isStyleLoadedRef.current = true;
      forceUpdate({});

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
      try {
        drawRouteLineRef.current();
      } catch {
        // noop
      }
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

    const busInterval = setInterval(() => {
      try {
        updateBusesRef.current();
      } catch {
        // noop
      }
    }, 5000);

    return () => {
      clearInterval(busInterval);
      busRequestIdRef.current += 1;
      Object.values(busMarkersRef.current).forEach(disposeBusMarker);
      busMarkersRef.current = {};

      if (currentLocationMarkerRef.current) {
        currentLocationMarkerRef.current.remove();
        currentLocationMarkerRef.current = null;
      }

      if (map.getLayer("user-location-accuracy-line"))
        map.removeLayer("user-location-accuracy-line");
      if (map.getLayer("user-location-accuracy-fill"))
        map.removeLayer("user-location-accuracy-fill");
      if (map.getSource("user-location-accuracy"))
        map.removeSource("user-location-accuracy");

      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        setIsUpdatesPaused(true);
      } else {
        setIsUpdatesPaused(false);
        lastActivityTimeRef.current = Date.now();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isStyleLoadedRef.current) return;
    applyLayerVisibility(map, activeLayer);
  }, [activeLayer, applyLayerVisibility]);

  useEffect(() => {
    if (!isStyleLoadedRef.current) return;
    drawRouteLine();
    updateStopMarkers();
    updateBuses();
  }, [drawRouteLine, updateStopMarkers, updateBuses]);

  useEffect(() => {
    if (!isStyleLoadedRef.current) return;
    updateBuses();
  }, [simTime, updateBuses]);

  return (
    <div className="map-container-wrapper">
      <div id="map" ref={mapContainerRef}></div>

      {/* 現在地ボタン */}
      <div
        id="location-control-container"
        className={isPanelOpen ? "panel-open" : ""}
      >
        <button
          id="location-btn"
          type="button"
          aria-label="現在地に移動"
          title="現在地に移動"
          onClick={handleLocateUser}
        >
          <span className="material-icons-outlined" aria-hidden>
            my_location
          </span>
        </button>
      </div>

      <div
        className={`map-attribution ${isPanelOpen ? "panel-open" : ""}`}
        role="note"
        aria-live="polite"
      >
        {activeLayer === "osm" ? (
          <>
            &copy;{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenStreetMap contributors
            </a>
          </>
        ) : (
          <a
            href="https://maps.gsi.go.jp/development/ichiran.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            地理院タイル
          </a>
        )}
      </div>
      {isUpdatesPaused && (
        <div className="updates-paused-overlay">
          <button
            onClick={() => {
              setIsUpdatesPaused(false);
              lastActivityTimeRef.current = Date.now();
              if (inactivityTimerRef.current) {
                clearTimeout(inactivityTimerRef.current);
              }
              inactivityTimerRef.current = setTimeout(
                () => {
                  setIsUpdatesPaused(true);
                },
                3 * 60 * 1000,
              );
            }}
            className="resume-button"
          >
            自動更新を停止しました。再開するにはここをクリック
          </button>
        </div>
      )}
    </div>
  );
};

export default MapContainer;
