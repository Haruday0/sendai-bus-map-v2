import React, { useState, useEffect, useRef } from "react";

interface LayerControlProps {
  activeLayer: "pale" | "ortho" | "osm";
  onLayerChange: (type: "pale" | "ortho" | "osm") => void;
}

const LayerControl: React.FC<LayerControlProps> = ({
  activeLayer,
  onLayerChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  return (
    <div id="layer-control-container" ref={containerRef}>
      {/* レイヤー切り替えボタン */}
      <button
        id="layer-btn"
        type="button"
        aria-label="地図レイヤー切り替え"
        title="地図レイヤー切り替え"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="material-icons-outlined" aria-hidden>
          layers
        </span>
      </button>

      <div id="layer-menu" className={isOpen ? "open" : ""}>
        <div className="layer-group-title">OpenStreetMap</div>
        <button
          type="button"
          className={`layer-item ${activeLayer === "osm" ? "active" : ""}`}
          onClick={() => {
            onLayerChange("osm");
            setIsOpen(false);
          }}
        >
          <img
            className="layer-item-icon"
            src="/osm_logo.svg"
            alt="OpenStreetMap"
            aria-hidden="true"
          />
          <span>OpenStreetMap</span>
        </button>

        <div className="layer-group-title">地理院タイル</div>
        <button
          type="button"
          className={`layer-item ${activeLayer === "pale" ? "active" : ""}`}
          onClick={() => {
            onLayerChange("pale");
            setIsOpen(false);
          }}
        >
          <span
            className="material-icons-outlined layer-item-icon-font"
            aria-hidden
          >
            map
          </span>
          <span>淡色地図</span>
        </button>

        <button
          type="button"
          className={`layer-item ${activeLayer === "ortho" ? "active" : ""}`}
          onClick={() => {
            onLayerChange("ortho");
            setIsOpen(false);
          }}
        >
          <span
            className="material-icons-outlined layer-item-icon-font"
            aria-hidden
          >
            photo_camera
          </span>
          <span>航空写真</span>
        </button>
      </div>
    </div>
  );
};

export default LayerControl;
