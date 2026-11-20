import React from "react";
import {
  Alert,
  Card,
  Chip,
  Link,
  Modal,
  Separator,
} from "@heroui/react";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ExternalLink: React.FC<{
  href: string;
  children: React.ReactNode;
}> = ({ href, children }) => (
  <Link
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline text-accent"
  >
    {children}
    <Link.Icon />
  </Link>
);

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop variant="blur">
        <Modal.Container placement="auto" scroll="inside" size="lg">
          <Modal.Dialog className="glass-surface-lg">
            <Modal.CloseTrigger aria-label="閉じる" />

            <Modal.Header>
              <Modal.Heading className="pr-8 text-lg font-bold">
                仙台バスマップ
              </Modal.Heading>
            </Modal.Header>

            <Modal.Body className="flex flex-col gap-4 text-sm leading-relaxed text-foreground">
              {/* リポジトリ紹介カード */}
              <a
                href="https://github.com/Haruday0/sendai-bus-map-v2"
                target="_blank"
                rel="noopener noreferrer"
                title="GitHubでリポジトリを開く"
                className="block rounded-3xl no-underline focus-visible:outline-2 focus-visible:outline-focus"
              >
                <Card
                  variant="secondary"
                  className="border border-separator bg-surface/55 transition-colors hover:bg-surface/80"
                >
                  <Card.Header className="flex-row items-center gap-2">
                    <svg
                      className="size-4 shrink-0 fill-muted"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                    >
                      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25H12a.25.25 0 0 1 .25.25v1.25a.25.25 0 0 1-.25.25H5.25a.25.25 0 0 1-.25-.25Z"></path>
                    </svg>
                    <Card.Title className="break-all text-accent">
                      Haruday0/sendai-bus-map-v2
                    </Card.Title>
                    <Chip size="sm" variant="soft" className="ml-auto">
                      Public
                    </Chip>
                  </Card.Header>

                  <Card.Content>
                    <Card.Description className="text-xs leading-normal">
                      仙台市営バスの現在位置・遅延状況をリアルタイムデータに基づいて可視化するWebアプリケーション
                    </Card.Description>
                  </Card.Content>

                  <Card.Footer className="gap-4 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block size-3 rounded-full bg-[#3178c6]"
                        aria-hidden="true"
                      />
                      TypeScript
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block size-3 rounded-full bg-[#00add8]"
                        aria-hidden="true"
                      />
                      Go
                    </span>
                  </Card.Footer>
                </Card>
              </a>

              <div className="space-y-2">
                <p>
                  仙台市営バスのバスの現在位置をリアルタイムデータに基づいて表示するウェブアプリです。
                </p>
                <p className="text-xs text-muted">
                  宮城交通など、仙台市営バス以外のバス会社には対応していません。
                </p>
                <p className="text-xs text-muted">
                  このウェブアプリはバックエンドに{" "}
                  <strong className="text-foreground">Go</strong>
                  、フロントエンドに{" "}
                  <strong className="text-foreground">
                    TypeScript (React + Vite)
                  </strong>{" "}
                  を使用して構成されています。
                </p>
              </div>

              <Separator />

              <section className="space-y-2">
                <h3 className="border-l-3 border-accent pl-2 text-base font-bold text-foreground">
                  主な機能
                </h3>
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>リアルタイムデータに基づくバスの現在位置の表示</li>
                  <li>各バス停の時刻表と、遅延に基づいた予想の時刻の表示</li>
                  <li>
                    バスごとの走行ルート表示{" "}
                    <del className="text-xs text-muted">
                      （仙台駅周辺とか一部のバス停周辺が変だけど）
                    </del>
                  </li>
                </ul>
              </section>

              <Separator />

              <section className="space-y-3">
                <h3 className="border-l-3 border-accent pl-2 text-base font-bold text-foreground">
                  出典・ライセンス
                </h3>
                <p>このアプリケーションは、以下を利用しています。</p>

                <div className="space-y-1">
                  <h4 className="font-semibold text-foreground">
                    バス運行データ
                  </h4>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <strong>データ名称:</strong>{" "}
                      <ExternalLink href="https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata_sendai_municipal_bus.html">
                        オープンデータ「仙台市営バス情報（標準的なバス情報フォーマット（GTFS-JP））」
                      </ExternalLink>
                    </li>
                    <li>
                      <strong>提供元:</strong>{" "}
                      <ExternalLink href="https://ckan.odpt.org/dataset/sendai_municipal_bus/resource/c3016c54-8be7-46a3-aa70-921847ac1bd9">
                        公共交通オープンデータセンター
                      </ExternalLink>
                    </li>
                    <li>
                      <strong>ライセンス:</strong>{" "}
                      <ExternalLink href="https://creativecommons.org/licenses/by/4.0/deed.ja">
                        クリエイティブ・コモンズ 表示 4.0 国際 (CC BY 4.0)
                      </ExternalLink>
                    </li>
                  </ul>
                </div>

                <div className="space-y-1">
                  <h4 className="font-semibold text-foreground">
                    リアルタイム運行データ
                  </h4>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <strong>データ名称:</strong>{" "}
                      <ExternalLink href="https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata_sendai_municipal_bus_realtime_information.html">
                        オープンデータ「仙台市営バス情報（標準的なバス情報フォーマット（GTFS-RT））」
                      </ExternalLink>
                    </li>
                    <li>
                      <strong>提供元:</strong>{" "}
                      <ExternalLink href="https://ckan.odpt.org/dataset/odpt_sendai_municipal_bus_realtime_information">
                        公共交通オープンデータセンター
                      </ExternalLink>
                    </li>
                    <li>
                      <strong>ライセンス:</strong>{" "}
                      <ExternalLink href="https://creativecommons.org/licenses/by/4.0/deed.ja">
                        クリエイティブ・コモンズ 表示 4.0 国際 (CC BY 4.0)
                      </ExternalLink>
                    </li>
                  </ul>
                </div>

                <div className="space-y-1">
                  <h4 className="font-semibold text-foreground">地図データ</h4>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <strong>地図タイル:</strong>{" "}
                      <ExternalLink href="https://www.maptiler.com/copyright/">
                        MapTiler
                      </ExternalLink>{" "}
                      /{" "}
                      <ExternalLink href="https://www.openstreetmap.org/copyright">
                        OpenStreetMap
                      </ExternalLink>{" "}
                      /{" "}
                      <ExternalLink href="https://maps.gsi.go.jp/development/ichiran.html">
                        国土地理院 地理院タイル
                      </ExternalLink>
                    </li>
                  </ul>
                </div>

                <div className="space-y-1">
                  <h4 className="font-semibold text-foreground">
                    ソフトウェア・サービス
                  </h4>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <strong>地図エンジン:</strong>{" "}
                      <ExternalLink href="https://maplibre.org/">
                        MapLibre GL JS
                      </ExternalLink>
                    </li>
                    <li>
                      <strong>ルート検索:</strong>{" "}
                      <ExternalLink href="http://project-osrm.org/">
                        OSRM (Open Source Routing Machine)
                      </ExternalLink>
                    </li>
                  </ul>
                </div>
              </section>

              <Alert status="default" className="border border-separator bg-surface/55">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>免責事項</Alert.Title>
                  <Alert.Description className="text-xs leading-relaxed">
                    このアプリは個人によって作成されたものであり、仙台市交通局の公式アプリではありません。
                    <br />
                    本アプリの利用によって生じた損害等について、制作者は一切の責任を負いません。
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
};

export default AboutModal;
