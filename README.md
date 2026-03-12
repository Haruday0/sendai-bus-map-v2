<h1 align="center">仙台市バスマップ</h1>

<p align="center"><a href="https://busmap.haruday0.live" target="_blank"><strong style="font-size:18px">https://busmap.haruday0.live/</strong></a></p>

仙台市営バスのバスの現在位置をリアルタイムデータに基づいて表示するウェブアプリです。

宮城交通など、仙台市営バス以外のバス会社には対応していません。

このウェブアプリはバックエンドに **Go**、フロントエンドに **TypeScript (React + Vite)** を使用して構成されています。

## 主な機能

- リアルタイムデータに基づくバスの現在位置の表示
- 各バス停の時刻表と、遅延に基づいた予想の時刻の表示
- バスごとの走行ルート表示 ~~（仙台駅周辺とか一部のバス停周辺が変だけど）~~

## 出典・ライセンス

このアプリケーションは、以下を利用しています。

### バス運行データ

- **データ名称**: [オープンデータ「仙台市営バス情報（標準的なバス情報フォーマット（GTFS-JP））」](https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata_sendai_municipal_bus.html)
- **提供元**: [公共交通オープンデータセンター](https://ckan.odpt.org/dataset/sendai_municipal_bus/resource/c3016c54-8be7-46a3-aa70-921847ac1bd9)
- **ライセンス**: [クリエイティブ・コモンズ 表示 4.0 国際 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/deed.ja)

### リアルタイム運行データ

- **データ名称**: [オープンデータ「仙台市営バス情報（標準的なバス情報フォーマット（GTFS-RT））」](https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata_sendai_municipal_bus_realtime_information.html)
- **提供元**: [公共交通オープンデータセンター](https://ckan.odpt.org/dataset/odpt_sendai_municipal_bus_realtime_information)
- **ライセンス**: [クリエイティブ・コモンズ 表示 4.0 国際 (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/deed.ja)

### 地図データ

- **地図タイル**: [国土地理院 地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)


### ソフトウェア・サービス

- **地図エンジン**: [MapLibre GL JS](https://maplibre.org/)
- **ルート検索**: [OSRM (Open Source Routing Machine)](http://project-osrm.org/)

## 免責事項

このアプリは個人によって作成されたものであり、仙台市交通局の公式アプリではありません。
本アプリの利用によって生じた損害等について、制作者は一切の責任を負いません。
