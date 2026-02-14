import React, { useState, useEffect } from "react";
import { Layers, Map as MapIcon, Camera } from "lucide-react";

interface LayerControlProps {
  activeLayer: "pale" | "ortho";
  onLayerChange: (type: "pale" | "ortho") => void;
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
        <Layers size={24} />
      </div>
      <div id="layer-menu" className={layerMenuOpen ? "show" : ""}>
        <div
          className={`layer-item ${activeLayer === "pale" ? "active" : ""}`}
          onClick={() => onLayerChange("pale")}
        >
          <MapIcon size={22} />
          淡色地図
        </div>
        <div
          className={`layer-item ${activeLayer === "ortho" ? "active" : ""}`}
          onClick={() => onLayerChange("ortho")}
        >
          <Camera size={22} />
          航空写真
        </div>
      </div>
    </div>
  );
};

export default LayerControl;
