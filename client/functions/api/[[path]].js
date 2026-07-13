export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 1. 転送先となる、本番のAzureサーバーのベースURL
  const AZURE_BACKEND =
    "https://bus-map-bzd9hhfedye5crcq.japaneast-01.azurewebsites.net";

  // 2. ブラウザが叩いたパス（例: /api/buses）とクエリパラメータ（例: ?minLat=...）をドッキング
  const targetUrl = `${AZURE_BACKEND}${url.pathname}${url.search}`;

  // 3. 元のリクエストのヘッダーやメソッド（GET/POST）を引き継いで、Azure用のリクエストを作成
  const modifiedRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "manual",
  });

  try {
    // 4. Cloudflareの高速ネットワーク経由で、裏側でAzureにフェッチ（転送）する
    const response = await fetch(modifiedRequest);

    // 5. Azureから返ってきたデータを、そのままブラウザに返す
    return response;
  } catch (err) {
    return new Response(`Proxy Error: ${err.message}`, { status: 502 });
  }
}
