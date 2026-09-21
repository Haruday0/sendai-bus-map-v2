import React, { useEffect } from "react";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  // ESCキーでウィンドウを閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="about-modal-overlay" onClick={onClose}>
      <div className="about-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* 閉じる（×）ボタン */}
        <button
          className="about-close-btn"
          onClick={onClose}
          aria-label="閉じる"
          title="閉じる"
        >
          <span className="material-icons-outlined" aria-hidden>
            close
          </span>
        </button>

        {/* ウィンドウ上部：タイトル */}
        <div className="about-modal-header">
          <h2>仙台バスマップ</h2>
        </div>

        {/* ウィンドウ本体 */}
        <div className="about-modal-body">
          {/* 💡 GitHub Primer公式仕様の「リポジトリ埋め込みカード」 */}
          <a
            href="https://github.com/Haruday0/sendai-bus-map-v2"
            target="_blank"
            rel="noopener noreferrer"
            className="primer-repo-card"
            title="GitHubでリポジトリを開く"
          >
            <div className="repo-card-header">
              {/* GitHub公式 Octicons: repo (リポジトリのブックマークアイコン) */}
              <svg
                className="octicon-repo"
                viewBox="0 0 16 16"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25H12a.25.25 0 0 1 .25.25v1.25a.25.25 0 0 1-.25.25H5.25a.25.25 0 0 1-.25-.25Z"></path>
              </svg>
              <span className="repo-title">Haruday0/sendai-bus-map-v2</span>
              <span className="repo-badge">Public</span>
            </div>

            <p className="repo-desc">
              仙台市営バスの現在位置・遅延状況をリアルタイムデータに基づいて可視化するWebアプリケーション
            </p>

            <div className="repo-card-meta">
              <span className="repo-meta-item">
                <span className="lang-color lang-ts"></span>
                TypeScript
              </span>
              <span className="repo-meta-item">
                <span className="lang-color lang-go"></span>
                Go
              </span>
            </div>
          </a>

          <p>
            仙台市営バスのバスの現在位置をリアルタイムデータに基づいて表示するウェブアプリです。
          </p>
          <p className="about-note">
            宮城交通など、仙台市営バス以外のバス会社には対応していません。
          </p>
          <p className="about-tech">
            このウェブアプリはバックエンドに <strong>Go</strong>
            、フロントエンドに <strong>TypeScript (React + Vite)</strong>{" "}
            を使用して構成されています。
          </p>

          <h3>主な機能</h3>
          <ul>
            <li>リアルタイムデータに基づくバスの現在位置の表示</li>
            <li>各バス停の時刻表と、遅延に基づいた予想の時刻の表示</li>
            <li>
              バスごとの走行ルート表示{" "}
              <del className="about-strike">
                （仙台駅周辺とか一部のバス停周辺が変だけど）
              </del>
            </li>
          </ul>

          <h3>出典・ライセンス</h3>
          <p>このアプリケーションは、以下を利用しています。</p>

          <h4>バス運行データ</h4>
          <ul>
            <li>
              <strong>データ名称:</strong>{" "}
              <a
                href="https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata_sendai_municipal_bus.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                オープンデータ「仙台市営バス情報（標準的なバス情報フォーマット（GTFS-JP））」
              </a>
            </li>
            <li>
              <strong>提供元:</strong>{" "}
              <a
                href="https://ckan.odpt.org/dataset/sendai_municipal_bus/resource/c3016c54-8be7-46a3-aa70-921847ac1bd9"
                target="_blank"
                rel="noopener noreferrer"
              >
                公共交通オープンデータセンター
              </a>
            </li>
            <li>
              <strong>ライセンス:</strong>{" "}
              <a
                href="https://creativecommons.org/licenses/by/4.0/deed.ja"
                target="_blank"
                rel="noopener noreferrer"
              >
                クリエイティブ・コモンズ 表示 4.0 国際 (CC BY 4.0)
              </a>
            </li>
          </ul>

          <h4>リアルタイム運行データ</h4>
          <ul>
            <li>
              <strong>データ名称:</strong>{" "}
              <a
                href="https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata_sendai_municipal_bus_realtime_information.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                オープンデータ「仙台市営バス情報（標準的なバス情報フォーマット（GTFS-RT））」
              </a>
            </li>
            <li>
              <strong>提供元:</strong>{" "}
              <a
                href="https://ckan.odpt.org/dataset/odpt_sendai_municipal_bus_realtime_information"
                target="_blank"
                rel="noopener noreferrer"
              >
                公共交通オープンデータセンター
              </a>
            </li>
            <li>
              <strong>ライセンス:</strong>{" "}
              <a
                href="https://creativecommons.org/licenses/by/4.0/deed.ja"
                target="_blank"
                rel="noopener noreferrer"
              >
                クリエイティブ・コモンズ 表示 4.0 国際 (CC BY 4.0)
              </a>
            </li>
          </ul>

          <h4>地図データ</h4>
          <ul>
            <li>
              <strong>地図タイル:</strong>{" "}
              <a
                href="https://maps.gsi.go.jp/development/ichiran.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                国土地理院 地理院タイル
              </a>
            </li>
          </ul>

          <h4>ソフトウェア・サービス</h4>
          <ul>
            <li>
              <strong>地図エンジン:</strong>{" "}
              <a
                href="https://maplibre.org/"
                target="_blank"
                rel="noopener noreferrer"
              >
                MapLibre GL JS
              </a>
            </li>
            <li>
              <strong>ルート検索:</strong>{" "}
              <a
                href="http://project-osrm.org/"
                target="_blank"
                rel="noopener noreferrer"
              >
                OSRM (Open Source Routing Machine)
              </a>
            </li>
          </ul>

          <h3>免責事項</h3>
          <div className="about-disclaimer">
            このアプリは個人によって作成されたものであり、仙台市交通局の公式アプリではありません。
            <br />
            本アプリの利用によって生じた損害等について、制作者は一切の責任を負いません。
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutModal;
