import React from "react";
import {
  Button,
  Dropdown,
  Header,
  Label,
  Separator,
} from "@heroui/react";
import type { MapLayerType } from "../types";
import { useTheme } from "../context/ThemeContext";

interface LayerControlProps {
  activeLayer: MapLayerType;
  onLayerChange: (type: MapLayerType) => void;
  hasMapTiler?: boolean;
}

const LayerControl: React.FC<LayerControlProps> = ({
  activeLayer,
  onLayerChange,
  hasMapTiler = false,
}) => {
  const { isDark } = useTheme();
  const autoIcon = isDark ? "night_sight_auto" : "light_mode_auto";

  return (
    <Dropdown>
      <Button
        isIconOnly
        variant="tertiary"
        aria-label="地図レイヤー切り替え"
        className="glass-surface rounded-full"
      >
        <span className="material-icons-outlined text-[22px]" aria-hidden>
          layers
        </span>
      </Button>

      <Dropdown.Popover
        placement="bottom end"
        className="glass-surface-lg z-[9100] w-60"
      >
        <Dropdown.Menu
          aria-label="地図レイヤー選択"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={new Set([activeLayer])}
          onSelectionChange={(keys) => {
            if (keys === "all") return;
            const selected = Array.from(keys)[0] as MapLayerType | undefined;
            if (selected) {
              onLayerChange(selected);
            }
          }}
        >
          {hasMapTiler && (
            <>
              <Dropdown.Section>
                <Header className="flex items-center gap-1.5">
                  <img
                    className="size-3.5 shrink-0"
                    src="/maptiler_logo.svg"
                    alt=""
                    aria-hidden="true"
                  />
                  <span>MapTiler (OpenStreetMap)</span>
                </Header>
                <Dropdown.Item
                  id="maptiler"
                  textValue="アプリの設定に合わせる"
                >
                  <Dropdown.ItemIndicator type="checkmark" />
                  <span
                    className="material-symbols-rounded inline-flex shrink-0 select-none items-center justify-center text-muted leading-none"
                    style={{ fontSize: "18px", width: "18px", height: "18px" }}
                    aria-hidden="true"
                  >
                    {autoIcon}
                  </span>
                  <Label>アプリの設定に合わせる</Label>
                </Dropdown.Item>
                <Dropdown.Item id="maptiler-light" textValue="ライトテーマ">
                  <Dropdown.ItemIndicator type="checkmark" />
                  <span
                    className="material-symbols-rounded inline-flex shrink-0 select-none items-center justify-center text-muted leading-none"
                    style={{ fontSize: "18px", width: "18px", height: "18px" }}
                    aria-hidden="true"
                  >
                    light_mode
                  </span>
                  <Label>ライトテーマ</Label>
                </Dropdown.Item>
                <Dropdown.Item id="maptiler-dark" textValue="ダークテーマ">
                  <Dropdown.ItemIndicator type="checkmark" />
                  <span
                    className="material-symbols-rounded inline-flex shrink-0 select-none items-center justify-center text-muted leading-none"
                    style={{ fontSize: "18px", width: "18px", height: "18px" }}
                    aria-hidden="true"
                  >
                    dark_mode
                  </span>
                  <Label>ダークテーマ</Label>
                </Dropdown.Item>
              </Dropdown.Section>

              <Separator />
            </>
          )}

          <Dropdown.Section>
            <Header>OpenStreetMap</Header>
            <Dropdown.Item id="osm" textValue="OpenStreetMap (標準)">
              <Dropdown.ItemIndicator type="checkmark" />
              <img
                className="size-[18px] shrink-0"
                src="/osm_logo.svg"
                alt=""
                aria-hidden="true"
              />
              <Label>{hasMapTiler ? "OpenStreetMap (標準)" : "OpenStreetMap"}</Label>
            </Dropdown.Item>
          </Dropdown.Section>

          <Separator />

          <Dropdown.Section>
            <Header>地理院タイル</Header>
            <Dropdown.Item id="pale" textValue="淡色地図">
              <Dropdown.ItemIndicator type="checkmark" />
              <span
                className="material-icons-outlined text-[18px] text-muted"
                aria-hidden
              >
                map
              </span>
              <Label>淡色地図</Label>
            </Dropdown.Item>
            <Dropdown.Item id="ortho" textValue="航空写真">
              <Dropdown.ItemIndicator type="checkmark" />
              <span
                className="material-icons-outlined text-[18px] text-muted"
                aria-hidden
              >
                photo_camera
              </span>
              <Label>航空写真</Label>
            </Dropdown.Item>
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
};

export default LayerControl;
