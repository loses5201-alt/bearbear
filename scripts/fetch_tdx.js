#!/usr/bin/env node
/**
 * fetch_tdx.js  —  BearBear 全台活動資料抓取腳本
 * ─────────────────────────────────────────────
 * 執行方式：
 *   node scripts/fetch_tdx.js
 *
 * 必要環境變數（在 GitHub Secrets 設定）：
 *   TDX_CLIENT_ID      TDX 平台申請的 Client ID
 *   TDX_CLIENT_SECRET  TDX 平台申請的 Client Secret
 *
 * TDX 申請網址：https://tdx.transportdata.gov.tw/register
 * 免費帳號每日可呼叫 50 次，每次最多 1000 筆，本腳本用量 < 10 次
 *
 * 輸出：data/events.json（供 index.html 直接 fetch）
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

/* ═══════════════════════════════════════════
   設定區
═══════════════════════════════════════════ */
const CONFIG = {
  CLIENT_ID     : process.env.TDX_CLIENT_ID     || '',
  CLIENT_SECRET : process.env.TDX_CLIENT_SECRET || '',
  TOKEN_URL     : 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
  BASE_URL      : 'https://tdx.transportdata.tw/api/basic/v2',
  /* 每批最多抓幾筆（TDX 單次上限 1000） */
  BATCH_SIZE    : 1000,
  /* 輸出路徑 */
  OUTPUT_PATH   : path.join(__dirname, '..', 'data', 'events.json'),
  /* 要抓的活動縣市（空陣列 = 全台灣） */
  TARGET_CITIES : [],
};

/* ═══════════════════════════════════════════
   顏色對應（縣市 → 主題色）
═══════════════════════════════════════════ */
const CITY_COLOR = {
  '臺北市':'#B1D8F3', '台北市':'#B1D8F3',
  '新北市':'#FFB7B2',
  '桃園市':'#B2EBF2',
  '臺中市':'#FFF1A8', '台中市':'#FFF1A8',
  '臺南市':'#FAC775', '台南市':'#FAC775',
  '高雄市':'#97C459',
  '基隆市':'#9FE1CB',
  '新竹市':'#CECBF6', '新竹縣':'#CECBF6',
  '苗栗縣':'#F5C4B3',
  '彰化縣':'#C0DD97',
  '南投縣':'#5DCAA5',
  '雲林縣':'#EF9F27',
  '嘉義市':'#FAC775', '嘉義縣':'#FAC775',
  '屏東縣':'#F0997B',
  '宜蘭縣':'#9FE1CB',
  '花蓮縣':'#C0DD97',
  '臺東縣':'#97C459', '台東縣':'#97C459',
  '澎湖縣':'#85B7EB',
  '金門縣':'#EF9F27',
  '連江縣':'#FAC775',
};

/* ═══════════════════════════════════════════
   工具函式
═══════════════════════════════════════════ */

/** 簡易 HTTPS GET，回傳 Promise<string> */
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} — ${url}`));
        } else {
          resolve(Buffer.concat(chunks).toString('utf8'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

/** HTTPS POST（application/x-www-form-urlencoded），回傳 Promise<string> */
function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path    : urlObj.pathname + urlObj.search,
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/x-www-form-urlencoded',
        'Content-Length': data.length,
      },
    };
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Token POST timeout')); });
    req.write(data);
    req.end();
  });
}

/** 正規化縣市名（臺→台、去掉市/縣後綴用於顯示） */
function normalizeCity(raw = '') {
  return raw.replace(/臺/g, '台').replace(/台北市|台北/, '台北')
            .replace(/新北市|新北/, '新北').replace(/桃園市|桃園/, '桃園')
            .replace(/台中市|台中/, '台中').replace(/台南市|台南/, '台南')
            .replace(/高雄市|高雄/, '高雄').replace(/宜蘭縣|宜蘭/, '宜蘭')
            .replace(/花蓮縣|花蓮/, '花蓮').replace(/台東縣|台東/, '台東')
            .replace(/基隆市|基隆/, '基隆').replace(/新竹市|新竹縣|新竹/, '新竹')
            .replace(/苗栗縣|苗栗/, '苗栗').replace(/彰化縣|彰化/, '彰化')
            .replace(/南投縣|南投/, '南投').replace(/雲林縣|雲林/, '雲林')
            .replace(/嘉義市|嘉義縣|嘉義/, '嘉義').replace(/屏東縣|屏東/, '屏東')
            .replace(/澎湖縣|澎湖/, '澎湖').replace(/金門縣|金門/, '金門')
            .replace(/連江縣|連江/, '連江') || '其他';
}

/** 從活動名稱與描述推斷 filter 關鍵字 */
function inferFilter(name = '', desc = '') {
  const text = (name + ' ' + desc).toLowerCase();
  const parts = [];
  if (/音樂|演唱|樂團|concert|音樂節/.test(text)) parts.push('music');
  if (/市集|攤販|手作|bazaar|跳蚤/.test(text))    parts.push('market');
  if (/展覽|美術|博物|gallery|特展|常設展/.test(text)) parts.push('art');
  if (/夜市|美食|小吃|food|吃貨/.test(text))       parts.push('food');
  if (/室內|館內|indoor|地下/.test(text))           parts.push('indoor');
  if (parts.length === 0) parts.push('art');  /* 預設歸展覽 */
  return parts.join(' ');
}

/** 將 TDX 原始活動物件轉換成 APP 內部格式 */
function transform(raw, index) {
  const name    = raw.ActivityName || raw.Name || '（未命名活動）';
  const rawCity = raw.City || raw.CityName || '';
  const city    = normalizeCity(rawCity) || '其他';
  const addr    = raw.Address || '';
  const desc    = raw.Description || '';
  const start   = (raw.StartTime || '').slice(0, 10);
  const end     = (raw.EndTime   || '').slice(0, 10);
  const lat     = parseFloat(raw.Position?.PositionLat ?? raw.Latitude  ?? 0) || 0;
  const lng     = parseFloat(raw.Position?.PositionLon ?? raw.Longitude ?? 0) || 0;
  const charge  = raw.Charge || '';
  const isFree  = !charge || /免費|0元|NT\$0/i.test(charge);
  const isIndoor= /室內|館內|地下|indoor/i.test(name + desc);
  const website = raw.WebsiteUrl || '';
  const filter  = inferFilter(name, desc) + (isFree ? ' free' : '');

  const rawCityFull = raw.City || raw.CityName || '';
  const barColor    = CITY_COLOR[rawCityFull]
                   || CITY_COLOR[rawCity]
                   || '#D3D1C7';

  /* 日期顯示字串 */
  const timeStr = start
    ? `${start}${end && end !== start ? ' – ' + end : ''}`
    : '時間洽主辦單位';

  /* tags 陣列 */
  const tags = [];
  if (isFree)    tags.push({ t: '免費', bg: '#B2EBF2', c: '#085041' });
  else           tags.push({ t: charge || '付費', bg: '#F1EFE8', c: '#4A2C1A' });
  if (isIndoor)  tags.push({ t: '室內', bg: '#E6F1FB', c: '#185FA5' });
  if (filter.includes('music'))  tags.push({ t: '音樂', bg: '#B1D8F3', c: '#0C447C' });
  if (filter.includes('market')) tags.push({ t: '市集', bg: '#FFF1A8', c: '#633806' });
  if (filter.includes('food'))   tags.push({ t: '美食', bg: '#FAC775', c: '#412402' });

  return {
    /* 基本資訊 */
    id         : raw.ActivityID || `tdx_${index}`,
    city, filter, lat, lng,
    bar        : barColor,
    pin        : barColor,
    pin_emoji  : isFree ? '★' : '◆',
    tags,
    name,
    time       : timeStr,
    dist       : '—',
    is_free    : isFree,
    is_indoor  : isIndoor,
    cost_est   : isFree ? 'NT$0（免費入場）' : (charge || '費用洽主辦單位'),
    /* 詳情頁 */
    hero_color : CITY_COLOR[rawCityFull] ? barColor.replace('F', '8') : '#185FA5',
    dtag       : `${city} · ${filter.split(' ')[0]}`,
    dtitle     : name,
    grid: [
      { icon: '🕗', lbl: '時間', val: timeStr },
      { icon: '📍', lbl: '地點', val: addr || city },
      { icon: '🎟', lbl: '票價', val: isFree ? '免費入場' : (charge || '洽主辦單位') },
      { icon: '🔗', lbl: '資訊', val: website ? '官網連結（見下方按鈕）' : '暫無官網' },
    ],
    pain: [
      { icon: '📋', bg: '#E6F1FB', txt: `<strong>主辦單位</strong>：${raw.Organizer || '詳見官網'}` },
      { icon: '📍', bg: '#FAEEDA', txt: `<strong>地址</strong>：${addr || '詳見官網'}` },
      { icon: '🎟', bg: '#E1F5EE', txt: `<strong>費用</strong>：${isFree ? '完全免費' : (charge || '洽主辦單位')}` },
      { icon: '🌐', bg: '#FBEAF0', txt: website
          ? `<strong>官網</strong>：<a href="${website}" target="_blank" rel="noopener" style="color:#185FA5">點此開啟</a>`
          : '<strong>官網</strong>：暫無' },
    ],
    food    : [],   /* TDX 無鄰近美食資料，可日後串 Google Places */
    website,
  };
}

/* ═══════════════════════════════════════════
   主流程
═══════════════════════════════════════════ */
async function main() {
  /* 1. 驗證環境變數 */
  if (!CONFIG.CLIENT_ID || !CONFIG.CLIENT_SECRET) {
    console.error('[Error] 請設定 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET 環境變數');
    console.error('        GitHub Actions 設定路徑：Settings → Secrets and variables → Actions');
    process.exit(1);
  }

  /* 2. 取得 OAuth2 Access Token */
  console.log('[1/4] 取得 TDX OAuth2 Token...');
  const tokenBody = new URLSearchParams({
    grant_type   : 'client_credentials',
    client_id    : CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET,
  }).toString();

  let token;
  try {
    const tokenRes = JSON.parse(await httpsPost(CONFIG.TOKEN_URL, tokenBody));
    token = tokenRes.access_token;
    if (!token) throw new Error('Token 欄位為空');
    console.log(`    ✅ Token 取得成功（${tokenRes.expires_in}s 有效）`);
  } catch (err) {
    console.error(`[Error] Token 取得失敗：${err.message}`);
    process.exit(1);
  }

  const authHeader = { Authorization: `Bearer ${token}` };

  /* 3. 分批抓取全台活動資料 */
  console.log('[2/4] 開始抓取 TDX 全台活動資料...');

  /* TDX API endpoint（觀光活動） */
  const endpoint = `${CONFIG.BASE_URL}/Tourism/Activity`;
  const allRaw   = [];

  /* 今天日期（ISO 格式），用於過濾已結束的活動 */
  const today = new Date().toISOString().slice(0, 10);
  /* OData $filter：只抓 EndTime >= 今天，或沒有 EndTime 的常設活動 */
  const dateFilter = encodeURIComponent(`EndTime ge ${today} or EndTime eq null`);

  /* 先抓第一批，確認總筆數 */
  const firstUrl = `${endpoint}?$filter=${dateFilter}&$top=${CONFIG.BATCH_SIZE}&$skip=0&$format=JSON`;
  let firstBatch;
  try {
    firstBatch = JSON.parse(await httpsGet(firstUrl, authHeader));
  } catch (err) {
    console.error(`[Error] 第一批資料抓取失敗：${err.message}`);
    process.exit(1);
  }

  const firstArr = Array.isArray(firstBatch) ? firstBatch : (firstBatch.value || []);
  allRaw.push(...firstArr);
  console.log(`    第 1 批：${firstArr.length} 筆`);

  /* 若第一批已達上限，繼續往後抓（最多抓 5000 筆） */
  if (firstArr.length === CONFIG.BATCH_SIZE) {
    for (let skip = CONFIG.BATCH_SIZE; skip < 5000; skip += CONFIG.BATCH_SIZE) {
      const url = `${endpoint}?$filter=${dateFilter}&$top=${CONFIG.BATCH_SIZE}&$skip=${skip}&$format=JSON`;
      try {
        const batch = JSON.parse(await httpsGet(url, authHeader));
        const arr   = Array.isArray(batch) ? batch : (batch.value || []);
        if (arr.length === 0) break;
        allRaw.push(...arr);
        console.log(`    第 ${skip / CONFIG.BATCH_SIZE + 1} 批：${arr.length} 筆`);
        if (arr.length < CONFIG.BATCH_SIZE) break;  /* 已抓完 */
      } catch (err) {
        console.warn(`    第 ${skip / CONFIG.BATCH_SIZE + 1} 批失敗（${err.message}），停止繼續`);
        break;
      }
    }
  }

  console.log(`    ✅ 共取得原始資料 ${allRaw.length} 筆`);

  /* 4. 過濾 + 轉換 */
  console.log('[3/4] 轉換資料格式...');

  /* 過濾掉沒有座標或名稱的垃圾資料 */
  const valid = allRaw.filter(r => {
    const name = r.ActivityName || r.Name || '';
    const lat  = parseFloat(r.Position?.PositionLat ?? r.Latitude  ?? 0);
    const lng  = parseFloat(r.Position?.PositionLon ?? r.Longitude ?? 0);
    return name.trim().length > 0 && (lat !== 0 || lng !== 0);
  });

  /* 縣市篩選（若有設定 TARGET_CITIES） */
  const filtered = CONFIG.TARGET_CITIES.length > 0
    ? valid.filter(r => {
        const city = normalizeCity(r.City || r.CityName || '');
        return CONFIG.TARGET_CITIES.includes(city);
      })
    : valid;

  const events = filtered.map((r, i) => transform(r, i));
  console.log(`    ✅ 有效活動 ${events.length} 筆（過濾掉 ${allRaw.length - valid.length} 筆無效資料）`);

  /* 5. 寫入輸出檔 */
  console.log('[4/4] 寫入 data/events.json...');

  /* 確保 data/ 目錄存在 */
  const outDir = path.dirname(CONFIG.OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const output = {
    updated_at: new Date().toISOString(),
    count     : events.length,
    source    : 'TDX 交通部觀光 API',
    events,
  };

  fs.writeFileSync(CONFIG.OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  const fileSizeKB = (fs.statSync(CONFIG.OUTPUT_PATH).size / 1024).toFixed(1);
  console.log(`    ✅ 寫入完成：${CONFIG.OUTPUT_PATH}`);
  console.log(`       檔案大小：${fileSizeKB} KB，共 ${events.length} 筆活動`);

  /* 城市分佈統計 */
  const cityCount = {};
  events.forEach(e => { cityCount[e.city] = (cityCount[e.city] || 0) + 1; });
  const topCities = Object.entries(cityCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([city, n]) => `${city}(${n})`)
    .join(' · ');
  console.log(`       城市分佈：${topCities}`);
  console.log('\n✅ 全部完成！');
}

main().catch(err => {
  console.error('\n[Fatal]', err.message);
  process.exit(1);
});
