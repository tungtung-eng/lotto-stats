# 大樂透統計

手機網頁 App：大樂透歷史號碼統計、7 個統計／AI 模型預測、回測成績（誠實跟亂選比較）、開獎公平性檢定、對獎。

- `tools/fetch.py`：從台灣彩券公開資料抓開獎號碼 → `docs/data/draws.json`（2007 年起）
- `tools/analyze.py`：公平性檢定、回測、下一期預測 → `docs/data/analysis.json`、`docs/data/live.json`
- `docs/`：網頁本體（GitHub Pages 用 main 的 /docs）
- `.github/workflows/update.yml`：每週二、五開獎後自動更新

本機手動更新：

    pip install -r requirements.txt
    python tools/fetch.py
    python tools/analyze.py

`live.json` 裡每期的預測在開獎前就固定，之後不改，用來累積上線後的真實戰績。
