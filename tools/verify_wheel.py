"""驗算包牌：把每一注真的列出來逐注對獎（暴力法），跟排列組合公式比，兩種算法要一模一樣"""
import json, itertools, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import analyze as A

rk = json.loads((A.DATA / "ranks.json").read_text("utf-8"))
idx = {d["p"]: i for i, d in enumerate(A.draws)}
for model in ("vote", "random"):
    for n in (6, 10, 12):
        tc = tm = fc = fm = wins = 0
        for p, top in zip(rk["periods"], rk["m"][model]):
            t = idx[p]
            nums = top[:n]
            c = m = 0
            for tk in itertools.combinations(nums, 6):
                c += 50
                m += A.grade(list(tk), t)[3]
            f = A.wheel(nums, t)
            assert (c, m) == (f["cost"], f["money"]), (model, n, p, c, m, f)
            tc += c; tm += m; wins += m >= c
        print(f"{model:6s} 包{n:2d}個  投入 {tc:>12,}  拿回 {tm:>12,}  回收率 {tm/tc:6.1%}  勝率 {wins/len(rk['periods']):6.1%}  （暴力法＝公式 OK）")
