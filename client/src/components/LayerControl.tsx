import React from "react";
import {
  Button,
  Dropdown,
  Header,
  Label,
  Separator,
} from "@heroui/react";

interface LayerControlProps {
  activeLayer: "pale" | "ortho" | "osm";
  onLayerChange: (type: "pale" | "ortho" | "osm") => void;
}

const LayerControl: React.FC<LayerControlProps> = ({
  activeLayer,
  onLayerChange,
}) => {
  return (
    <div
      id="layer-control-container"
      className="absolute top-5 right-5 z-[9000] transition-[opacity,visibility] duration-250 max-md:top-[65px] max-md:right-2.5 max-md:[body.is-searching_&]:pointer-events-none max-md:[body.is-searching_&]:invisible max-md:[body.is-searching_&]:opacity-0"
    >
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

        <Dropdown.Popover placement="bottom end" className="glass-surface-lg w-52">
          <Dropdown.Menu
            aria-label="地図レイヤー選択"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={new Set([activeLayer])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0] as
                | "pale"
                | "ortho"
                | "osm"
                | undefined;
              if (selected) {
                onLayerChange(selected);
              }
            }}
          >
            <Dropdown.Section>
              <Header>OpenStreetMap</Header>
              <Dropdown.Item id="osm" textValue="OpenStreetMap">
                <Dropdown.ItemIndicator type="checkmark" />
                <img
                  className="size-[18px] shrink-0"
                  src="/osm_logo.svg"
                  alt=""
                  aria-hidden="true"
                />
                <Label>OpenStreetMap</Label>
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
    </div>
  );
};

export default LayerControl;
