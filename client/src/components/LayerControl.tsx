import React, { useState, useEffect } from "react";
// use Material Icons font for UI icons

interface LayerControlProps {
  activeLayer: "pale" | "ortho" | "osm";
  onLayerChange: (type: "pale" | "ortho" | "osm") => void;
}

const LayerControl: React.FC<LayerControlProps> = ({
  activeLayer,
  onLayerChange,
}) => {
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);

  // 外クリックでメニューを閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("#layer-control-container")) {
        setLayerMenuOpen(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return (
    <div id="layer-control-container">
      <div
        id="layer-btn"
        onClick={(e) => {
          e.stopPropagation();
          setLayerMenuOpen((v) => !v);
        }}
        title="地図レイヤー切り替え"
      >
        <span className="material-icons-outlined" aria-hidden>
          layers
        </span>
      </div>
      <div id="layer-menu" className={layerMenuOpen ? "show" : ""}>
        <div className="layer-group-title">OpenStreetMap</div>
        <div
          className={`layer-item ${activeLayer === "osm" ? "active" : ""}`}
          onClick={() => onLayerChange("osm")}
        >
          <img
            className="layer-item-icon"
            src="/osm_logo.svg"
            alt=""
            aria-hidden
            loading="eager"
            decoding="async"
          />
          OpenStreetMap
        </div>

        <div className="layer-group-title">地理院タイル</div>
        <div
          className={`layer-item ${activeLayer === "pale" ? "active" : ""}`}
          onClick={() => onLayerChange("pale")}
        >
          <span className="material-icons-outlined" aria-hidden>
            map
          </span>
          淡色地図
        </div>
        <div
          className={`layer-item ${activeLayer === "ortho" ? "active" : ""}`}
          onClick={() => onLayerChange("ortho")}
        >
          <span className="material-icons-outlined" aria-hidden>
            photo_camera
          </span>
          航空写真
        </div>
      </div>
    </div>
  );
};

export default LayerControl;
