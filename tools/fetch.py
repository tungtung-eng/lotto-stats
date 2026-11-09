"""抓台灣彩券大樂透開獎號碼 → docs/data/draws.json
用法：python tools/fetch.py          只補缺的月份（最近 2 個月一定重抓）
      python tools/fetch.py --all    從頭全部重抓
"""
import json, sys, time, urllib.request, datetime, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data" / "draws.json"
API = "https://api.taiwanlottery.com/TLCAPIWeB/Lottery/Lotto649Result?period&month={m}&pageNum=1&pageSize=50"
START = (2004, 1)


TIERS = ["jackpotAssign", "secondAssign", "thirdAssign", "fourthAssign",
         "fifthAssign", "sixthAssign", "seventhAssign", "normalAssign"]


def prizes(x):
    out = []
    for k in TIERS:
        a = x.get(k) or {}
        if a.get("winnerCount"):
            out.append(a.get("perPrize") or 0)
        else:
            out.append((a.get("prize") or 0) + (a.get("lastPrize") or 0))
    return out


def get_month(y, m):
    url = API.format(m=f"{y:04d}-{m:02d}")
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "lotto-stats"})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
            res = (d.get("content") or {}).get("lotto649Res") or []
            out = []
            for x in res:
                n = x["drawNumberSize"]
                out.append({
                    "p": x["period"],
                    "d": x["lotteryDate"][:10],
                    "n": sorted(n[:6]),
                    "s": n[6],
                    "o": x.get("drawNumberAppear"),  # 開出順序
                    "w": prizes(x),  # 頭獎～普獎每注獎金（沒人中＝該獎項累積總額）
                })
            return out
        except Exception as e:
            print("  重試", url, e)
            time.sleep(3 * (i + 1))
    raise SystemExit("抓不到：" + url)


def months(a, b):
    y, m = a
    while (y, m) <= b:
        yield y, m
        m += 1
        if m > 12:
            y, m = y + 1, 1


def main():
    full = "--all" in sys.argv
    old = {}
    if OUT.exists() and not full:
        old = {x["p"]: x for x in json.loads(OUT.read_text("utf-8"))["draws"]}
    today = datetime.date.today()
    done = {x["d"][:7] for x in old.values()}
    recent = {f"{today.year:04d}-{today.month:02d}"}
    pm = (today.replace(day=1) - datetime.timedelta(days=1))
    recent.add(f"{pm.year:04d}-{pm.month:02d}")
    for y, m in months(START, (today.year, today.month)):
        key = f"{y:04d}-{m:02d}"
        if key in done and key not in recent:
            continue
        rows = get_month(y, m)
        for r in rows:
            old[r["p"]] = r
        print(key, len(rows))
        time.sleep(0.3)
    draws = sorted(old.values(), key=lambda x: x["p"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated": datetime.datetime.now().isoformat(timespec="minutes"),
                               "draws": draws}, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print("共", len(draws), "期，最早", draws[0]["d"], "最新", draws[-1]["d"], draws[-1]["p"])


if __name__ == "__main__":
    main()
