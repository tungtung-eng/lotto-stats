"""大樂透統計／AI 模型分析 → docs/data/analysis.json、docs/data/live.json

做三件事：
1. 公平性檢定：實際開出的號碼分布，跟「完全公平」的理論差多少（卡方檢定）
2. 回測：假裝回到過去，每期開獎前只用「當時已知」的資料，讓每個模型選 6 個號碼，
   跟真正開出的號碼對，算平均對中幾個、中獎幾次、花多少拿回多少，並跟亂選比較
3. 下一期預測：每個模型用全部資料選下一期號碼；同一期只記一次（開獎前就固定，不能事後改），
   開獎後自動對獎，累積成「上線後真實戰績」

用法：python tools/analyze.py
"""
import json, math, datetime, pathlib, warnings
import numpy as np
from scipy import stats
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.neural_network import MLPClassifier

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
N, K = 49, 6
TICKET = 50
BT_START = 1000          # 從第 1000 期（約 2016 年）開始回測，前面的資料當「教材」
RETRAIN = 100            # AI 模型每 100 期重新學一次
SEED = 20261109

draws = json.loads((DATA / "draws.json").read_text("utf-8"))["draws"]
T = len(draws)
X = np.zeros((T, N), dtype=np.int8)        # 一般號
S = np.zeros(T, dtype=np.int16)            # 特別號
for t, d in enumerate(draws):
    X[t, np.array(d["n"]) - 1] = 1
    S[t] = d["s"]

# ---------------------------------------------------------------- 共用：特徵
cum = np.vstack([np.zeros((1, N), dtype=np.int32), np.cumsum(X, axis=0, dtype=np.int32)])  # cum[t]＝前 t 期合計


def freq(t, w):
    """第 t 期之前、最近 w 期，每個號碼出現幾次"""
    a = max(0, t - w)
    return cum[t] - cum[a]


# gap[t]＝到第 t 期之前，每個號碼已經幾期沒開
gap = np.zeros((T + 1, N), dtype=np.int32)
for t in range(T):
    gap[t + 1] = np.where(X[t] == 1, 0, gap[t] + 1)

# 馬可夫轉移：trans[t]＝前 t 期中「i 開出後下一期開 j」的次數
trans = np.zeros((T + 1, N, N), dtype=np.int32)
for t in range(1, T):
    trans[t + 1] = trans[t] + np.outer(X[t - 1], X[t])
trans[1] = trans[0]


def markov_score(t):
    if t < 2:
        return np.zeros(N)
    last = X[t - 1].astype(bool)
    base = np.maximum(cum[t - 1][last], 1)            # i 出現過幾次（扣掉最後一期，它還沒有「下一期」）
    return (trans[t][last] / base[:, None]).sum(axis=0)


def feats(t):
    """第 t 期每個號碼的特徵（只用 t 之前的資料）→ (49, 8)"""
    return np.column_stack([
        freq(t, 10), freq(t, 30), freq(t, 100),
        cum[t] / max(t, 1),
        np.minimum(gap[t], 60),
        X[t - 1] if t > 0 else np.zeros(N),
        markov_score(t),
        np.arange(1, N + 1),
    ]).astype(np.float32)


# ---------------------------------------------------------------- 模型
# 每個模型：給第 t 期，回傳 49 個分數，分數最高的 6 個就是它選的號碼

def m_hot(t):
    return freq(t, 30) - gap[t] * 1e-3


def m_cold(t):
    return gap[t] + freq(t, 100) * 1e-3


def m_bayes(t):
    # 狄利克雷事前（每號 1 次）＋ 指數衰減加權（半衰期 200 期）的事後平均
    a = max(0, t - 1500)
    if t == a:
        return np.ones(N)
    age = np.arange(t - a)[::-1]
    w = 0.5 ** (age / 200)
    return 1 + (w[:, None] * X[a:t]).sum(axis=0)


def m_markov(t):
    return markov_score(t)


class Trained:
    """要「學」的模型：每 RETRAIN 期用當時已知的資料重新訓練一次"""

    def __init__(self):
        self.model, self.until = None, -1

    def __call__(self, t):
        if self.model is None or t >= self.until + RETRAIN:
            self.fit(t)
            self.until = t
        return self.score(t)


class GBM(Trained):
    def fit(self, t):
        ts = range(100, t)
        Xf = np.vstack([feats(i) for i in ts])
        y = np.concatenate([X[i] for i in ts])
        self.model = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.05, max_leaf_nodes=15,
                                                    l2_regularization=1.0, random_state=SEED).fit(Xf, y)

    def score(self, t):
        return self.model.predict_proba(feats(t))[:, 1]


LAG = 10


def lagged(t):
    return X[t - LAG:t].reshape(-1).astype(np.float32)


class NN(Trained):
    def fit(self, t):
        ts = range(LAG, t)
        A = np.vstack([lagged(i) for i in ts])
        B = np.vstack([X[i] for i in ts])
        self.model = MLPClassifier(hidden_layer_sizes=(64, 32), alpha=1e-3, max_iter=300,
                                   early_stopping=True, random_state=SEED).fit(A, B)

    def score(self, t):
        return self.model.predict_proba(lagged(t)[None, :])[0]


MODELS = [
    ("hot", "熱號模型", "最近 30 期出現最多次的號碼"),
    ("cold", "冷號回補", "最久沒開出的號碼（賭它「該出來了」）"),
    ("bayes", "貝氏統計", "統計學的貝氏估計：長期資料打底，越近的期數權重越高（半衰期 200 期）"),
    ("markov", "馬可夫鏈", "看歷史上「上期開了這幾個，下期最常接哪幾個」"),
    ("gbm", "機器學習（梯度提升樹）", "AI 從 8 種特徵（近10/30/100期次數、遺漏期數、上期有無、馬可夫分數、號碼本身…）自己學規則，近 10 萬筆資料訓練"),
    ("nn", "神經網路", "AI 深度學習：輸入最近 10 期的完整開獎紀錄，讓兩層神經網路自己找規律"),
    ("vote", "綜合投票", "以上 6 個模型各自排名後加總，選總分最高的 6 個"),
]


def make_fns():
    return {"hot": m_hot, "cold": m_cold, "bayes": m_bayes, "markov": m_markov, "gbm": GBM(), "nn": NN()}


JITTER = np.random.default_rng(SEED).random(N) * 1e-9   # 分數相同時，用固定的亂數打破平手（不偏小號或大號）
TOP = 12                                                 # 包牌最多選 12 個號碼


def ranking(score, n=TOP):
    """分數由高到低的前 n 個號碼（照名次排）"""
    return (np.argsort(-(score + JITTER))[:n] + 1).tolist()


def pick(score):
    return sorted(ranking(score, K))


def vote(scores):
    total = np.zeros(N)
    for sc in scores.values():
        total += stats.rankdata(sc)
    return total


# ---------------------------------------------------------------- 對獎
TIER_NAMES = ["頭獎", "貳獎", "參獎", "肆獎", "伍獎", "陸獎", "柒獎", "普獎"]


def tier(hits, sp):
    if hits == 6: return 0
    if hits == 5: return 1 if sp else 2
    if hits == 4: return 3 if sp else 4
    if hits == 3: return 5 if sp else 7
    if hits == 2 and sp: return 6
    return None


def grade(nums, t):
    real = set(draws[t]["n"])
    h = len(real & set(nums))
    sp = draws[t]["s"] in nums
    tr = tier(h, sp)
    money = 0
    if tr is not None:
        w = draws[t].get("w") or []
        money = w[tr] if tr < len(w) else 0
    return h, sp, tr, money


def wheel(nums, t):
    """包牌（複式）：nums 裡任選 6 個的所有組合都買，算總獎金。回傳 {cost, money}"""
    real = set(draws[t]["n"])
    n = len(nums)
    h = len(real & set(nums))
    sp = 1 if draws[t]["s"] in nums else 0
    w = draws[t].get("w") or []
    money = 0
    for k in range(0, min(h, K) + 1):
        # 不含特別號的組合：k 個中的號碼 + 其他從「沒中也不是特別號」的號碼裡挑
        for with_sp in (0, 1):
            if with_sp and not sp:
                continue
            others = n - h - sp
            cnt = math.comb(h, k) * math.comb(others, K - k - with_sp)
            tr = tier(k, bool(with_sp))
            if cnt and tr is not None and tr < len(w):
                money += cnt * w[tr]
    return {"cost": math.comb(n, K) * TICKET, "money": int(money)}


# ---------------------------------------------------------------- 理論值
def hyper(k):  # 6 個裡面對中 k 個的機率
    return math.comb(K, k) * math.comb(N - K, K - k) / math.comb(N, K)


EXP_HITS = K * K / N
VAR_HITS = K * (K / N) * ((N - K) / N) * ((N - K) / (N - 1))


def evaluate(rec):
    hits = np.array([r[0] for r in rec])
    n = len(hits)
    mean = float(hits.mean())
    z = (mean - EXP_HITS) / math.sqrt(VAR_HITS / n)
    p = float(stats.norm.sf(z))         # 單尾：比亂選「好」的機率有多碰巧
    dist = [int((hits == k).sum()) for k in range(K + 1)]
    tiers = [0] * 8
    money = 0
    for h, sp, tr, m in rec:
        if tr is not None:
            tiers[tr] += 1
            money += m
    roll = np.convolve(hits, np.ones(50) / 50, mode="valid")
    return {
        "n": n, "mean": round(mean, 4), "z": round(z, 2), "p": round(p, 4),
        "dist": dist, "tiers": tiers, "wins": int(sum(tiers)),
        "cost": n * TICKET, "money": int(money),
        "roll": [round(float(v), 3) for v in roll[::10]],
    }


# ---------------------------------------------------------------- 1. 公平性檢定
def fairness():
    obs = X.sum(axis=0)
    exp = T * K / N
    chi = stats.chisquare(obs)
    so = np.bincount(S, minlength=N + 1)[1:]
    chi_s = stats.chisquare(so)
    resid = (obs - exp) / math.sqrt(exp * (1 - K / N))
    # 奇數個數分布（49 個號碼裡 25 個奇數）
    odd_th = [math.comb(25, k) * math.comb(24, K - k) / math.comb(N, K) for k in range(K + 1)]
    odd_ob = np.bincount([sum(v % 2 for v in d["n"]) for d in draws], minlength=K + 1)
    chi_odd = stats.chisquare(odd_ob, np.array(odd_th) * T)
    big_ob = np.bincount([sum(v >= 25 for v in d["n"]) for d in draws], minlength=K + 1)
    chi_big = stats.chisquare(big_ob, np.array(odd_th) * T)
    consec_th = 1 - math.comb(N - K + 1, K) / math.comb(N, K)
    consec_ob = sum(any(b - a == 1 for a, b in zip(d["n"], d["n"][1:])) for d in draws) / T
    return {
        "draws": T, "expected": round(exp, 2),
        "obs": obs.tolist(), "resid": [round(float(v), 2) for v in resid],
        "chi": round(float(chi.statistic), 2), "p": round(float(chi.pvalue), 4),
        "chi_s": round(float(chi_s.statistic), 2), "p_s": round(float(chi_s.pvalue), 4),
        "odd_th": [round(v, 4) for v in odd_th], "odd_ob": odd_ob.tolist(), "p_odd": round(float(chi_odd.pvalue), 4),
        "big_ob": big_ob.tolist(), "p_big": round(float(chi_big.pvalue), 4),
        "consec_th": round(consec_th, 4), "consec_ob": round(consec_ob, 4),
    }


# ---------------------------------------------------------------- 2. 回測
def backtest():
    fns = make_fns()
    rec = {k: [] for k, _, _ in MODELS}
    rec["random"] = []
    rng = np.random.default_rng(SEED)
    rng_top = np.random.default_rng(SEED + 1)
    last_picks = {}
    ranks = {k: [] for k in rec}       # 每期各模型前 12 名，給網頁算包牌
    for t in range(BT_START, T):
        scores = {k: fns[k](t) for k in fns}
        scores["vote"] = vote(scores)
        for k in rec:
            ranks[k].append((rng_top.permutation(N)[:TOP] + 1).tolist() if k == "random" else ranking(scores[k]))
            nums = sorted((rng.choice(N, K, replace=False) + 1).tolist()) if k == "random" else pick(scores[k])
            rec[k].append(grade(nums, t))
            if t == T - 1:
                last_picks[k] = nums
        if (t - BT_START) % 200 == 0:
            print("  回測", t, "/", T)
    (DATA / "ranks.json").write_text(json.dumps({
        "from": BT_START, "periods": [d["p"] for d in draws[BT_START:]], "m": ranks,
    }, separators=(",", ":")), "utf-8")
    return {k: evaluate(v) for k, v in rec.items()}, last_picks


# ---------------------------------------------------------------- 3. 下一期
def next_period():
    last = draws[-1]
    d = datetime.date.fromisoformat(last["d"]) + datetime.timedelta(days=1)
    while d.weekday() not in (1, 4):      # 週二、週五
        d += datetime.timedelta(days=1)
    roc = d.year - 1911
    p = last["p"] + 1 if last["p"] // 1000000 == roc else roc * 1000000 + 1
    return p, d.isoformat()


def predict_next():
    fns = make_fns()
    scores = {k: fns[k](T) for k in fns}
    scores["vote"] = vote(scores)
    out = {}
    for k, _, _ in MODELS:
        sc = scores[k]
        nums = pick(sc)
        # 特別號參考：剩下 43 個裡分數最高的
        rest = [i for i in np.argsort(-sc) if i + 1 not in nums]
        out[k] = {"n": nums, "s": int(rest[0] + 1), "top": ranking(sc)}
    return out


def update_live(pred, period, date):
    path = DATA / "live.json"
    live = json.loads(path.read_text("utf-8")) if path.exists() else {"preds": {}}
    key = str(period)
    if key not in live["preds"]:        # 開獎前就固定，之後不改
        live["preds"][key] = {"date": date, "made": datetime.datetime.now().isoformat(timespec="minutes"),
                              "picks": {k: v["n"] for k, v in pred.items()},
                              "tops": {k: v["top"] for k, v in pred.items()}}
    elif "tops" not in live["preds"][key] and "result" not in live["preds"][key]:
        # 包牌功能上線前就存的那一期：還沒開獎、用的是同一份資料，補上前 12 名
        live["preds"][key]["tops"] = {k: v["top"] for k, v in pred.items()}
    idx = {d["p"]: i for i, d in enumerate(draws)}
    for p, e in live["preds"].items():
        t = idx.get(int(p))
        if t is not None and "result" not in e:
            e["result"] = {k: dict(zip(["hits", "sp", "tier", "money"], grade(v, t))) for k, v in e["picks"].items()}
            if "tops" in e:
                e["wheel10"] = {k: wheel(v[:10], t) for k, v in e["tops"].items()}
    path.write_text(json.dumps(live, ensure_ascii=False, indent=1), "utf-8")
    return live


def main():
    print("公平性檢定…")
    fair = fairness()
    print("回測（約 1～2 分鐘）…")
    bt, _ = backtest()
    print("下一期預測…")
    pred = predict_next()
    period, date = next_period()
    update_live(pred, period, date)
    out = {
        "updated": datetime.datetime.now().isoformat(timespec="minutes"),
        "last": draws[-1],
        "next": {"p": period, "d": date, "picks": pred},
        "models": [{"id": k, "name": n, "desc": d} for k, n, d in MODELS],
        "theory": {"exp_hits": round(EXP_HITS, 4), "dist": [round(hyper(k), 6) for k in range(K + 1)],
                   "jackpot": math.comb(N, K),
                   # 任何獎：對中 3 個以上，或對中 2 個＋特別號（特別號從沒開出的 43 個裡開，你剩 4 個號碼）
                   "win": round(sum(hyper(k) for k in range(3, K + 1)) + hyper(2) * (K - 2) / (N - K), 6)},
        "bt": {"from": draws[BT_START]["d"], "to": draws[-1]["d"], "res": bt},
        "fair": fair,
        "tier_names": TIER_NAMES,
    }
    (DATA / "analysis.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print("完成。回測平均對中（亂選理論 %.3f）：" % EXP_HITS)
    for k, v in bt.items():
        print(f"  {k:7s} {v['mean']:.3f}  p={v['p']:.3f}  中獎{v['wins']:4d}次  花{v['cost']:>7,}  拿回{v['money']:>9,}")


if __name__ == "__main__":
    main()
