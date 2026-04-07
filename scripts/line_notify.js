#!/usr/bin/env node
/**
 * scripts/line_notify.js
 * 讀取 data/events.json，透過 LINE Notify 發送每日更新報告
 *
 * 環境變數（GitHub Secrets）：
 *   LINE_NOTIFY_TOKEN  — LINE Notify 權杖
 *   取得網址：https://notify-bot.line.me/my/
 */
'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TOKEN     = process.env.LINE_NOTIFY_TOKEN || '';
const JSON_PATH = path.join(__dirname, '..', 'data', 'events.json');

if (!TOKEN) {
  console.error('[line_notify] 請設定 LINE_NOTIFY_TOKEN');
  process.exit(1);
}

if (!fs.existsSync(JSON_PATH)) {
  console.error('[line_notify] data/events.json 不存在');
  process.exit(1);
}

const data       = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const count      = data.count ?? data.events?.length ?? 0;
const updatedAt  = data.updated_at ?? '未知';

/* 城市分佈統計 Top 5 */
const cityMap = {};
(data.events || []).forEach(e => { cityMap[e.city] = (cityMap[e.city] || 0) + 1; });
const top5 = Object.entries(cityMap)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([c, n]) => `${c} ${n} 筆`)
  .join('、');

const message = [
  '',
  '🐻 BearBear 每日資料更新報告',
  `📅 更新時間：${updatedAt.slice(0,16).replace('T',' ')} (UTC)`,
  `📊 全台活動總筆數：${count} 筆`,
  `🗺️ 熱門城市：${top5 || '無資料'}`,
  count > 0 ? '✅ 資料健康，APP 正常運作中！' : '⚠️ 活動數量為 0，請手動確認！',
].join('\n');

/* POST to LINE Notify */
const body = new URLSearchParams({ message }).toString();
const req  = https.request({
  hostname: 'notify-api.line.me',
  path    : '/api/notify',
  method  : 'POST',
  headers : {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type' : 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
  },
}, res => {
  const ok = res.statusCode === 200;
  console.log(`[line_notify] HTTP ${res.statusCode} — ${ok ? '發送成功 ✅' : '發送失敗 ❌'}`);
  process.exit(ok ? 0 : 1);
});
req.on('error', err => { console.error('[line_notify]', err.message); process.exit(1); });
req.write(body);
req.end();
