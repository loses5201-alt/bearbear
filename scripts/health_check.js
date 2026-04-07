#!/usr/bin/env node
/**
 * scripts/health_check.js
 * 在 commit 前驗證 data/events.json 健康度
 * 任何檢查失敗都 throw Error，讓 GitHub Actions 步驟失敗並阻止 commit
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const JSON_PATH   = path.join(__dirname, '..', 'data', 'events.json');
const MIN_SIZE_KB = 10;
const MIN_COUNT   = 10;   /* 合理的最低活動筆數 */

/* 1. 檔案存在 */
if (!fs.existsSync(JSON_PATH)) {
  throw new Error(`[health_check] ❌ data/events.json 不存在！`);
}

/* 2. 檔案大小 */
const sizeKB = fs.statSync(JSON_PATH).size / 1024;
if (sizeKB < MIN_SIZE_KB) {
  throw new Error(`[health_check] ❌ 檔案太小 (${sizeKB.toFixed(1)} KB < ${MIN_SIZE_KB} KB)，疑似 API 異常，阻止 commit！`);
}

/* 3. JSON 可解析 */
let data;
try {
  data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
} catch (e) {
  throw new Error(`[health_check] ❌ JSON 解析失敗：${e.message}`);
}

/* 4. events 陣列長度 */
const events = data.events ?? (Array.isArray(data) ? data : []);
if (events.length < MIN_COUNT) {
  throw new Error(`[health_check] ❌ 活動數量異常 (${events.length} 筆 < ${MIN_COUNT} 筆)，阻止 commit！`);
}

/* 5. updated_at 欄位存在且為今天（防止撈到舊快取） */
if (data.updated_at) {
  const age = Date.now() - new Date(data.updated_at).getTime();
  const ageHr = age / 3600000;
  if (ageHr > 25) {
    /* 警告但不中斷（可能是 API 臨時回舊資料） */
    console.warn(`[health_check] ⚠️ updated_at 距今 ${ageHr.toFixed(1)} 小時，資料可能過舊`);
  }
}

console.log(`[health_check] ✅ 通過！${events.length} 筆活動，${sizeKB.toFixed(1)} KB — 允許 commit`);
